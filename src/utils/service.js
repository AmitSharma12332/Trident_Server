import axios from "axios";
import { API_BASE_URL } from "../../src/app.js";
import { TryCatch } from "../middlewares/error.js";
import { Bet } from "../models/bet.js";
import { Margin } from "../models/margin.js";
import { User } from "../models/user.js";
import { ErrorHandler } from "./utility-class.js";
import { calculateProfitAndLoss } from "./helper.js";

const chunkArray = (array, size) => {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, index) =>
    array.slice(index * size, index * size + size)
  );
};

const fetchOddsInBatches = async (baseUrl, ids) => {
  const batches = chunkArray(ids, 50);
  const responses = await Promise.all(
    batches.map((batch) =>
      axios
        .get(`${baseUrl}?Mids=${batch.join(",")}`)
        .then((res) => res.data)
        .catch(() => [])
    )
  );
  return responses.flat();
};

const getAllMarkets = TryCatch(async (req, res, next) => {
  const { eventId, sportId } = req.query;
  if (!eventId) return next(new ErrorHandler("EventId is Required", 400));
  if (!sportId) return next(new ErrorHandler("SportId is Required", 400));

  // Fetch all events
  const eventRes = await axios.get(
    `${API_BASE_URL}/GetMasterbysports?sid=${sportId}`
  );
  const allEvents = eventRes.data || [];
  const eventDetail =
    allEvents.find((event) => event.event.id == eventId) || null;

  // Fetch bookmaker and fancy markets
  const [matchOddsRes, bookmakerRes, fancyRes] = await Promise.all([
    axios.get(`${API_BASE_URL}/RMatchOdds?Mids=${eventDetail?.market?.id}`),
    axios.get(`${API_BASE_URL}/GetBookMaker?eventid=${eventId}`),
    axios.get(`${API_BASE_URL}/GetFancy?eventid=${eventId}`),
  ]);

  // Take only the first 25 from each
  const bookmakerData = bookmakerRes.data || [];
  const fancyData = fancyRes.data || [];
  const matchOddsData = matchOddsRes.data || [];

  // Get market IDs for API request
  const bookmakerIds = bookmakerData.map((b) => b.market.id);
  const fancyIds = fancyData.map((f) => f.market.id);

  // Fetch odds
  const [bookMakerOddsRes, fancyOddsRes] = await Promise.all([
    fetchOddsInBatches(`${API_BASE_URL}/RBookmaker`, bookmakerIds),
    fetchOddsInBatches(`${API_BASE_URL}/RFancy`, fancyIds),
  ]);

  // Map odds back to their respective markets
  const getBookmaker = bookmakerData.map((b) => {
    const odds =
      bookMakerOddsRes.find((odd) => odd.marketId === b.market.id) || [];

    if (
      b.market.status === "OPEN" &&
      b.market.name === "Bookmaker 0%Comm" &&
      odds.runners
    ) {
      const updateOdds = (runnerIndex, type, multiplier) => {
        if (
          odds.runners?.[runnerIndex]?.[type]?.[0]?.price === 0 &&
          matchOddsData?.[0]?.runners?.[runnerIndex]?.[type]?.[0]
        ) {
          odds.runners[runnerIndex][type][0].price =
            Math.floor(
              matchOddsData[0].runners[runnerIndex][type][0].price * 100
            ) - 100;
          odds.runners[runnerIndex][type][0].size =
            matchOddsData[0].runners[runnerIndex][type][0].size * multiplier;
        }
      };

      updateOdds(0, "back", 2);
      updateOdds(0, "lay", 3);
      updateOdds(1, "back", 3);
      updateOdds(1, "lay", 2);
    }

    return { ...b, odds };
  });

  const getFancy = fancyData.map((f) => ({
    ...f,
    odds: fancyOddsRes.find((odd) => odd.marketId === f.market.id) || [],
  }));

  const responseData = { eventId, eventDetail, getBookmaker, getFancy };

  return res.json(responseData);
});

const settleBets = async (eventId) => {
  try {
    // const pendingBets = await Bet.find({ _id: "67c85e3566b65881353a3be2" });
    const pendingBets = await Bet.find({ eventId, status: "pending" });
    if (pendingBets.length === 0) {
      console.log(`No pending bets found for event Id: ${eventId}`);
      return;
    }

    const matchOddsMarketIds = new Set();
    const bookmakerMarketIds = new Set();
    const fancyMarketIds = new Set();

    pendingBets.forEach(({ category, marketId }) => {
      if (category === "bookmaker") bookmakerMarketIds.add(marketId);
      if (category === "fancy") fancyMarketIds.add(marketId);
      if (category === "match odds") matchOddsMarketIds.add(marketId);
    });

    // Fetch market results in batches
    const [matchOddsRes, bookmakerRes, fancyRes] = await Promise.allSettled([
      fetchOddsInBatches(`${API_BASE_URL}/RMatchOdds`, [...matchOddsMarketIds]),
      fetchOddsInBatches(`${API_BASE_URL}/RBookmaker`, [...bookmakerMarketIds]),
      fetchOddsInBatches(`${API_BASE_URL}/RFancy`, [...fancyMarketIds]),
    ]);

    // Handle failures gracefully
    const formatResults = (res) =>
      res.status === "fulfilled" && res.value
        ? new Map(
            res.value
              .filter((m) => m.winner !== undefined && m.winner !== null)
              .map((m) => [m.marketId, m.winner])
          )
        : new Map();

    // const fancyResults = new Map();
    // fancyResults.set("4.1741063872898-F2", 89);
    const matchOddsResults = formatResults(matchOddsRes);
    const bookmakerResults = formatResults(bookmakerRes);
    const fancyResults = formatResults(fancyRes);

    console.log(`For Event Id: ${eventId}`);
    console.log("Odds: ", JSON.stringify(Object.fromEntries(matchOddsResults)));
    console.log("BM: ", JSON.stringify(Object.fromEntries(bookmakerResults)));
    console.log("Fancy: ", JSON.stringify(Object.fromEntries(fancyResults)));

    const margins = await Margin.find({ eventId })
      .sort({ createdAt: -1 })
      .lean();

    const marginMap = new Map();

    // Store only the first occurrence for each (userId, marketId) pair
    for (const margin of margins) {
      const key = `${margin.userId}-${margin.marketId}`;
      if (!marginMap.has(key)) marginMap.set(key, margin);
    }

    // Prepare bet updates and user balance updates
    const betUpdates = [];
    const userUpdates = new Map();
    // const processedBets = new Set();

    for (const bet of pendingBets) {
      const {
        userId,
        category,
        marketId,
        selectionId,
        type,
        odds,
        fancyNumber,
        stake,
      } = bet;
      let isWinningBet = false;
      let isMarketResultAvailable = false;

      if (category === "match odds" && matchOddsResults.has(marketId)) {
        // const margin = marginMap.get(`${userId}-${marketId}`);
        // if (!margin) {
        //   console.log(
        //     `No margin found! event: ${eventId}, market: ${marketId} user: ${userId}`
        //   );
        //   return;
        // }

        // const updateAmount = Math.abs(Math.min(margin.profit, margin.loss, 0));
        // const betKey = `${userId}-${marketId}`;
        // if (!processedBets.has(betKey)) {
        //   processedBets.add(betKey);
        //   userUpdates.set(
        //     userId,
        //     (userUpdates.get(userId) || 0) + updateAmount
        //   );
        // }

        isWinningBet =
          (matchOddsResults.get(marketId) === selectionId && type === "back") ||
          (matchOddsResults.get(marketId) !== selectionId && type === "lay");

        isMarketResultAvailable = true;
      } else if (category === "bookmaker" && bookmakerResults.has(marketId)) {
        // const margin = marginMap.get(`${userId}-${marketId}`);
        // if (!margin) {
        //   console.log(
        //     `No margin found! event: ${eventId}, market: ${marketId} user: ${userId}`
        //   );
        //   return;
        // }

        // const updateAmount = Math.abs(Math.min(margin.profit, margin.loss, 0));
        // const betKey = `${userId}-${marketId}`;
        // if (!processedBets.has(betKey)) {
        //   processedBets.add(betKey);
        //   userUpdates.set(
        //     userId,
        //     (userUpdates.get(userId) || 0) + updateAmount
        //   );
        // }

        isWinningBet =
          (bookmakerResults.get(marketId) === selectionId && type === "back") ||
          (bookmakerResults.get(marketId) !== selectionId && type === "lay");

        isMarketResultAvailable = true;
      } else if (category === "fancy" && fancyResults.has(marketId)) {
        const winnerNumber = fancyResults.get(marketId);

        isWinningBet =
          (type === "back" && fancyNumber <= winnerNumber) ||
          (type === "lay" && fancyNumber > winnerNumber);

        isMarketResultAvailable = true;
      }

      // Skip the bet if no market result is available
      if (!isMarketResultAvailable) continue;

      // Update bet status if market result exists
      betUpdates.push({
        updateOne: {
          filter: { _id: bet._id },
          update: { status: isWinningBet ? "won" : "lost" },
        },
      });

      // Update user balance
      const { profit, loss } = calculateProfitAndLoss(
        stake,
        odds,
        type,
        category
      );
      const balanceChange = isWinningBet ? profit : loss;
      userUpdates.set(userId, (userUpdates.get(userId) || 0) + balanceChange);
    }

    // Bulk update bets
    if (betUpdates.length > 0) {
      await Bet.bulkWrite(betUpdates);
      console.log(`Bets Updates:`, JSON.stringify(betUpdates, null, 2));
    }

    // Bulk update user balances
    if (userUpdates.size > 0) {
      const userBalanceUpdates = [...userUpdates].map(([userId, amount]) => ({
        updateOne: {
          filter: { _id: userId },
          update: { $inc: { amount } },
        },
      }));
      await User.bulkWrite(userBalanceUpdates);
      console.log(
        "User Updates: ",
        JSON.stringify(userBalanceUpdates, null, 2)
      );
    }

    // console.log(`Bets Updates:`, JSON.stringify(betUpdates, null, 2));
    // console.log(`User Updates:`, Object.fromEntries(userUpdates));
    console.log(`Bets for event Id: ${eventId} settled successfully.`);
  } catch (error) {
    console.error(`Error settling bets for event Id: ${eventId}:`, error);
  }
};

export { getAllMarkets, settleBets };
