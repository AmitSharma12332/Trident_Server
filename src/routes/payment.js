import express from "express";
import {
  changeWithdrawStatus,
  depositHistory,
  getUserDepositHistory,
  getUserWithdrawlHistory,
  withdrawalHistory,
  withdrawalRequest,
} from "../controllers/payment.js";
import { adminOrSuperAdmin, isAuthenticated } from "../middlewares/auth.js";

const app = express.Router();

app.use(isAuthenticated);

app.get("/user-deposit-history", getUserDepositHistory);

app.get("/deposit-history", adminOrSuperAdmin, depositHistory);

app.get("/user-withdrawal-history", getUserWithdrawlHistory);

app.get("/withdrawal-history", adminOrSuperAdmin, withdrawalHistory);

app.post("/withdrawal-request", withdrawalRequest);

app.post("/withdrawal-status", adminOrSuperAdmin, changeWithdrawStatus);

export default app;
