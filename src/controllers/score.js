import axios from "axios";
import { API_BASE_URL } from "../app.js";
import { TryCatch } from "../middlewares/error.js";

const cricketScore = TryCatch(async (req, res, next) => {
  const { eventId } = req.query;
  const response = await axios.get(
    `${API_BASE_URL}/cricketscore?eventid=${eventId}`
  );
  return res.status(200).json({
    success: true,
    message: "Score fetched successfully",
    score: response?.data,
  });
});

const otherScores = TryCatch(async (req, res, next) => {
  const { eventId } = req.query;
  const response = await axios.get(`${API_BASE_URL}/score?eventid=${eventId}`);
  return res.status(200).json({
    success: true,
    message: "Score fetched successfully",
    score: response?.data,
  });
});

export { cricketScore, otherScores };
