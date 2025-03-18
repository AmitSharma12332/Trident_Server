import express from "express";
import { cricketScore, otherScores } from "../controllers/score.js";

const app = express.Router();

app.get("/cricket", cricketScore);

app.get("/scores", otherScores);

export default app;
