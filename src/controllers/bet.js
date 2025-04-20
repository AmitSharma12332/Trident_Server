import axios from "axios";
import { API_BASE_URL } from "../app.js";
import { TryCatch } from "../middlewares/error.js";
import { Bet } from "../models/bet.js";
import { Margin } from "../models/margin.js";
import { User } from "../models/user.js";
import {
  calculateFancyExposure,
  calculateNewMargin,
  calculateProfitAndLoss,
  calculateTotalExposure,
} from "../utils/helper.js";
import { ErrorHandler } from "../utils/utility-class.js";

const placeBet = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User not found", 404));

  if (user.status === "banned")
    return next(
      new ErrorHandler("Your account is banned. Please contact support.", 400)
    );

  let {
    eventId,
    match,
    marketId,
    selection,
    selectionId,
    fancyNumber,
    stake,
    odds,
    category,
    type,
  } = req.body;

  category = category?.toLowerCase().trim();
  type = type?.toLowerCase().trim();

  if (
    !(
      eventId &&
      marketId &&
      stake &&
      odds &&
      category &&
      type &&
      match &&
      selection
    )
  )
    return next(new ErrorHandler("Please provide all required fields", 400));

  const validCategories = ["match odds", "fancy", "bookmaker"];
  const validTypes = ["back", "lay"];

  if (!validCategories.includes(category))
    return next(new ErrorHandler("Invalid Category", 400));
  if (!validTypes.includes(type))
    return next(new ErrorHandler("Invalid Type", 400));

  if (category !== "fancy" && !selectionId)
    return next(new ErrorHandler("Selection ID is required", 400));

  if (category === "fancy") {
    if (!fancyNumber)
      return next(new ErrorHandler("Please provide a fancy number", 400));
    if (stake < 100 || stake > 500000)
      return next(
        new ErrorHandler("Stake must be between 100 and 5 Lakh", 400)
      );
  }

  const endpoints = {
    bookmaker: `${API_BASE_URL}/RBookmaker?Mids=${marketId}`,
    "match odds": `${API_BASE_URL}/RMatchOdds?Mids=${marketId}`,
    fancy: `${API_BASE_URL}/RFancy?Mids=${marketId}`,
  };

  const endpoint = endpoints[category] || endpoints.fancy;
  const response = await axios.get(endpoint);

  if (!response.data || !response.data.length)
    return next(new ErrorHandler("Odds Expired", 400));

  const data = response.data[0];
  const isValidOdds = (list, odds) =>
    list?.slice(0, 3).some((o) => o?.price === odds);

  if (category === "match odds") {
    const runner = data?.runners.find((r) => r.selectionId === selectionId);
    if (!runner) return next(new ErrorHandler("Odds Expired", 400));

    const priceList = type === "back" ? runner.back : runner.lay;
    if (!priceList || !Array.isArray(priceList) || priceList.length < 3)
      return next(new ErrorHandler("Invalid odds data", 400));

    if (!isValidOdds(priceList, odds)) {
      return next(new ErrorHandler("Odds Changed", 400));
    }
  } else if (category === "bookmaker") {
    const [matchOddsRes, bookmakerRes] = await Promise.all([
      axios.get(`${API_BASE_URL}/RMatchOdds?Mids=${matchOddsMarketId}`),
      axios.get(`${API_BASE_URL}/GetBookMaker?eventid=${eventId}`),
    ]);

    const matchOddsData = matchOddsRes.data[0];
    const bookmakerData = bookmakerRes.data || [];

    if (!matchOddsData || !Array.isArray(matchOddsData?.runners))
      return next(new ErrorHandler("Invalid bookmaker odds data", 400));

    let val1 = null,
      val2 = null;
    bookmakerData.map((b) => {
      const hasZeroPercent = /0%\b/i.test(b.market.name);
      const isMarketOpen = b.market.status?.toLowerCase().trim() === "open";

      if (isMarketOpen && hasZeroPercent && data?.runners) {
        const runner0Price = matchOddsData?.runners?.[0]?.[type]?.[0]?.price;
        const runner1Price = matchOddsData?.runners?.[1]?.[type]?.[0]?.price;

        if (typeof runner0Price === "number")
          val1 = Math.floor(runner0Price * 100) - 100;

        if (typeof runner1Price === "number")
          val2 = Math.floor(runner1Price * 100) - 100;
      }
    });

    const runner = data?.runners.find((r) => r.selectionId === selectionId);
    if (!runner) return next(new ErrorHandler("Odds Expired", 400));

    const priceList = type === "back" ? runner.back : runner.lay;
    if (!priceList || !Array.isArray(priceList) || priceList.length < 3)
      return next(new ErrorHandler("Invalid odds data", 400));

    if (
      ![
        priceList[0].price,
        priceList[1]?.price,
        priceList[2]?.price,
        val1,
        val2,
      ].includes(odds)
    ) {
      return next(new ErrorHandler("Odds Changed", 400));
    }
  } else {
    const priceList = type === "back" ? data.back : data.lay;
    if (!priceList || !Array.isArray(priceList) || priceList.length < 3)
      return next(new ErrorHandler("Invalid odds data", 400));

    if (priceList[0].price !== fancyNumber || priceList[0].size !== odds)
      return next(new ErrorHandler("Odds Changed", 400));
  }

  const { profit, loss, error } = calculateProfitAndLoss(
    stake,
    odds,
    type,
    category
  );
  if (error) return next(new ErrorHandler(error, 400));

  const exposure = await calculateTotalExposure(user._id);

  if (category !== "fancy") {
    const margin = await Margin.findOne({ userId: user._id, eventId, marketId })
      .sort({ createdAt: -1 })
      .lean();

    if (!margin) {
      if (user.amount - exposure < Math.abs(loss))
        return next(new ErrorHandler("Insufficient balance", 400));

      await Margin.create({
        userId: user._id,
        eventId,
        marketId,
        selectionId,
        profit: type === "back" ? profit : loss,
        loss: type === "back" ? loss : profit,
      });
    } else {
      const { newProfit, newLoss } = calculateNewMargin(
        margin,
        selectionId,
        type,
        profit,
        loss
      );

      if (
        user.amount -
          exposure +
          Math.abs(Math.min(margin.profit, margin.loss, 0)) <
        Math.abs(Math.min(newProfit, newLoss, 0))
      )
        return next(new ErrorHandler("Insufficient balance", 400));

      await Margin.create({
        userId: user._id,
        eventId,
        marketId,
        selectionId,
        profit: margin.selectionId === selectionId ? newProfit : newLoss,
        loss: margin.selectionId === selectionId ? newLoss : newProfit,
      });
    }
  } else {
    const tempBet = await Bet.create({
      userId: user._id,
      eventId,
      match,
      selection,
      marketId,
      selectionId,
      fancyNumber,
      stake,
      odds,
      category,
      type,
      payout: stake + profit,
    });

    const newExposure = await calculateTotalExposure(user._id);
    await Bet.deleteOne({ _id: tempBet._id });

    if (user.amount - newExposure < 0)
      return next(new ErrorHandler("Insufficient balance", 400));
  }

  const newBet = await Bet.create({
    userId: user._id,
    eventId,
    match,
    selection,
    marketId,
    selectionId,
    fancyNumber,
    stake,
    odds,
    category,
    type,
    payout: stake + profit,
  });

  return res.status(201).json({
    success: true,
    message: "Bet placed successfully",
    newBet,
  });
});

const betTransactions = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User not found", 404));

  const { eventId } = req.query;

  const filter = { userId: user._id };
  if (eventId) filter.eventId = eventId;

  const bets = await Bet.find(filter).sort({ createdAt: -1 });

  return res.status(200).json({
    success: true,
    message: "Bets fetched successfully",
    bets,
  });
});

const getMargins = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User Not Found", 400));

  const { eventId } = req.query;
  if (!eventId) return next(new ErrorHandler("Event ID is required", 400));

  const margins = await Margin.find({ userId: user._id, eventId }).sort({
    createdAt: -1,
  });

  const latestMargins = {};
  for (const margin of margins) {
    if (!latestMargins[margin.marketId]) {
      latestMargins[margin.marketId] = margin;
    }
  }

  return res.status(200).json({
    success: true,
    message: "Margins fetched successfully",
    margins: latestMargins,
  });
});

const getFancyExposure = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User not found", 404));

  const { eventId } = req.query;
  if (!eventId) return next(new ErrorHandler("Event ID is required", 400));

  const marketExposure = await calculateFancyExposure(user._id, eventId);

  return res.status(200).json({
    success: true,
    message: "Fancy exposure fetched successfully",
    marketExposure,
  });
});

const getTotalExposure = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User not found", 404));

  const exposure = await calculateTotalExposure(user._id);

  return res.status(200).json({
    success: true,
    message: "Total exposure fetched successfully",
    exposure,
  });
});

const getBets = TryCatch(async (req, res, next) => {
  const { status, userId, selectionId, eventId, category, type } = req.query;

  const filter = {};

  if (status) {
    if (!["won", "pending", "lost"].includes(status)) {
      return next(new ErrorHandler("Invalid status", 400));
    }
    filter.status = status;
  }

  if (type) {
    if (!["back", "lay"].includes(type)) {
      return next(new ErrorHandler("Invalid type", 400));
    }
    filter.type = type;
  }

  if (category) {
    if (!["match odds", "bookmaker", "fancy"].includes(category)) {
      return next(new ErrorHandler("Invalid category", 400));
    }
    filter.category = category;
  }

  if (userId) filter.userId = userId;
  if (selectionId) filter.selectionId = selectionId;
  if (eventId) filter.eventId = eventId;

  const bets = await Bet.find(filter).sort({ createdAt: -1 });

  return res.status(200).json({
    success: true,
    message: "Bets fetched successfully",
    bets,
  });
});

const changeBetStatus = TryCatch(async (req, res, next) => {
  const { betId, status } = req.body;

  const validStatuses = ["won", "lost", "pending", "cancelled"];
  if (!validStatuses.includes(status)) {
    return next(new ErrorHandler("Invalid status value", 400));
  }

  const bet = await Bet.findById(betId);
  if (!bet) return next(new ErrorHandler("Bet not found", 404));

  if (bet.status === status)
    return next(
      new ErrorHandler(`Bet status is already set to ${status}`, 400)
    );

  const allowedTransitions = {
    pending: ["won", "lost", "cancelled"],
    won: ["lost"],
    lost: ["won"],
    cancelled: ["pending", "won", "lost"],
  };

  if (!allowedTransitions[bet.status].includes(status)) {
    return next(
      new ErrorHandler(
        `Cannot change status from ${bet.status} to ${status}`,
        400
      )
    );
  }

  const user = await User.findById(bet.userId);
  if (!user) return next(new ErrorHandler("User not found", 404));

  if (bet.status === "pending") {
    if (status === "won") user.amount += bet.payout - bet.stake;
    else if (status === "lost") user.amount -= bet.stake;
  } else if (bet.status === "lost") {
    user.amount += bet.payout;
  } else if (bet.status === "won") {
    if (user.amount < bet.payout - 2 * bet.stake) {
      return next(
        new ErrorHandler("Insufficient balance to reverse winnings", 400)
      );
    }
    user.amount = user.amount - bet.payout - 2 * bet.stake;
  } else if (bet.status === "cancelled") {
    if (status === "won") user.amount += bet.payout - bet.stake;
    else if (status === "lost") user.amount -= bet.stake;
  }

  await user.save();
  bet.status = status;
  await bet.save();

  return res.status(200).json({
    success: true,
    message: `Bet status changed successfully to ${status}`,
    bet,
  });
});

export {
  betTransactions,
  changeBetStatus,
  getBets,
  getFancyExposure,
  getMargins,
  getTotalExposure,
  placeBet,
};
