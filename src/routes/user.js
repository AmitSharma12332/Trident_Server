import express from "express";
import {
  addAmount,
  changeUserStatus,
  getAllUsers,
  getMyProfile,
  login,
  newUser,
} from "../controllers/user.js";
import { adminOrSuperAdmin, isAuthenticated } from "../middlewares/auth.js";

const app = express.Router();

app.post("/login", login);

app.use(isAuthenticated);

app.post("/new", adminOrSuperAdmin, newUser);

app.get("/me", getMyProfile);

app.get("/allusers", adminOrSuperAdmin, getAllUsers);

app.post("/userstatus/:id", adminOrSuperAdmin, changeUserStatus);

app.put("/addamount/:id", adminOrSuperAdmin, addAmount);

export default app;
