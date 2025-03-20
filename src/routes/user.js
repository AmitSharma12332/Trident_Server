import express from "express";
import {
  addAmount,
  changePassword,
  changeUserStatus,
  deleteUser,
  getAllUsers,
  getMyProfile,
  login,
  newUser,
  reduceAmount,
} from "../controllers/user.js";
import { adminOrSuperAdmin, isAuthenticated } from "../middlewares/auth.js";

const app = express.Router();

app.post("/login", login);

app.use(isAuthenticated);

app.post("/new", adminOrSuperAdmin, newUser);

app.post("/change-password", changePassword);

app.get("/me", getMyProfile);

app.get("/allusers", adminOrSuperAdmin, getAllUsers);

app.post("/userstatus/:id", adminOrSuperAdmin, changeUserStatus);

app.put("/addamount/:id", adminOrSuperAdmin, addAmount);

app.put("/reduceamount/:id", adminOrSuperAdmin, reduceAmount);

app.post("/deleteuser/:id", adminOrSuperAdmin, deleteUser);

export default app;
