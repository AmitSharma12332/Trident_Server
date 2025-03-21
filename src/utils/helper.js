import { Bet } from "../models/bet.js";
import { Margin } from "../models/margin.js";

const calculateProfitAndLoss = (stake, odds, type, category) => {
  let profit = 0;
  let loss = 0;

  category = category.toLowerCase().trim();
  type = type.toLowerCase().trim();

  if (!["match odds", "bookmaker", "fancy"].includes(category))
    return {
      error: "Invalid category! Must be 'match odds', 'bookmaker', or 'fancy'.",
    };

  if (!["back", "lay"].includes(type))
    return { error: "Invalid bet type! Must be 'back' or 'lay'." };

  const isBack = type === "back";

  switch (category) {
    case "match odds":
      profit = isBack ? stake * (odds - 1) : stake;
      loss = isBack ? -stake : -stake * (odds - 1);
      break;

    case "bookmaker":
      profit = isBack ? (odds * stake) / 100 : stake;
      loss = isBack ? -stake : -(odds * stake) / 100;
      break;

    case "fancy":
      profit = isBack ? (stake * odds) / 100 : stake;
      loss = isBack ? -stake : -(stake * odds) / 100;
      break;
  }

  return { profit, loss };
};

const calculateNewMargin = (margin, selectionId, type, profit, loss) => {
  const isSameSelection = margin.selectionId === selectionId;
  const isBack = type === "back";

  return {
    newProfit: margin.profit + (isSameSelection === isBack ? profit : loss),
    newLoss: margin.loss + (isSameSelection === isBack ? loss : profit),
  };
};

const calculateFancyExposure = async (userId, eventId) => {
  const bets = await Bet.find({
    userId,
    eventId,
    status: "pending",
    category: "fancy",
  }).sort({ fancyNumber: 1 });

  const marketBets = {};
  for (const bet of bets) {
    if (!marketBets[bet.marketId]) marketBets[bet.marketId] = [];
    marketBets[bet.marketId].push(bet);
  }

  const marketExposure = {};
  for (const [marketId, betList] of Object.entries(marketBets)) {
    let firstBackIndex = -1;
    let firstLayFromLastIndex = -1;
    let exposure = 0;

    for (let i = 0; i < betList.length; i++) {
      if (betList[i].type === "back") {
        firstBackIndex = i;
        break;
      }
    }

    for (let i = betList.length - 1; i >= 0; i--) {
      if (betList[i].type === "lay") {
        firstLayFromLastIndex = i;
        break;
      }
    }

    if (
      firstBackIndex !== -1 &&
      firstLayFromLastIndex !== -1 &&
      firstBackIndex < firstLayFromLastIndex
    ) {
      for (let i = 0; i < firstBackIndex; i++)
        exposure += (betList[i].stake * betList[i].odds) / 100;

      let exp = 0;
      for (let i = firstBackIndex; i <= firstLayFromLastIndex; i++) {
        const { type, stake, odds } = betList[i];
        const calculatedValue = (stake * odds) / 100;

        exp += type === "back" ? calculatedValue : -calculatedValue;
      }
      exposure += Math.abs(exp);

      for (let i = firstLayFromLastIndex + 1; i < betList.length; i++)
        exposure += betList[i].stake;
    } else {
      for (const { type, stake, odds } of betList)
        exposure += type === "back" ? stake : (stake * odds) / 100;
    }

    marketExposure[marketId] = -exposure;
  }
  return marketExposure;
};

const calculateTotalExposure = async (userId) => {
  const nonFancyMarketIds = await Bet.distinct("marketId", {
    userId,
    status: "pending",
    category: { $ne: "fancy" },
  });

  const nonFancyMargins = await Margin.find({
    userId,
    marketId: { $in: nonFancyMarketIds },
  })
    .sort({ createdAt: -1 })
    .lean();

  const latestMargins = {};
  for (const margin of nonFancyMargins) {
    if (!latestMargins[margin.marketId]) {
      latestMargins[margin.marketId] = margin;
    }
  }

  let totalExposure = 0;
  const margins = Object.values(latestMargins);
  for (const margin of margins) {
    let maxLoss = 0;
    if (margin.profit < 0 && margin.loss > 0)
      maxLoss += Math.abs(margin.profit);
    if (margin.profit < 0 && margin.loss < 0) {
      maxLoss += Math.max(Math.abs(margin.profit), Math.abs(margin.loss));
    } else if (margin.loss < 0) {
      maxLoss += Math.abs(margin.loss);
    }
    totalExposure += maxLoss;
  }

  const eventIds = await Bet.distinct("eventId", {
    userId,
    status: "pending",
    category: "fancy",
  });

  for (const eventId of eventIds) {
    const marketExposure = await calculateFancyExposure(userId, eventId);
    totalExposure += Object.values(marketExposure).reduce(
      (sum, value) => sum + Math.abs(value),
      0
    );
  }

  return totalExposure;
};

const getFormattedTimestamp = () => {
  return new Date()
    .toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    .replace(",", "");
};

export {
  calculateFancyExposure,
  calculateNewMargin,
  calculateProfitAndLoss,
  calculateTotalExposure,
  getFormattedTimestamp,
};
