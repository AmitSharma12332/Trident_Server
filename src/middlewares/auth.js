import jwt from "jsonwebtoken";
import { User } from "../models/user.js";
import { ErrorHandler } from "../utils/utility-class.js";
import { TryCatch } from "./error.js";

const isAuthenticated = TryCatch(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next(new ErrorHandler("No token provided", 401));
  const token = authHeader.split(" ")[1];

  // const token = req.cookies[GAME_TOKEN];
  if (!token) return next(new ErrorHandler("Invalid token format", 401));

  try {
    const decodedData = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ _id: decodedData._id });
    if (!user)
      return next(new ErrorHandler("Not authorized, user not found", 404));

    if (user.status === "banned")
      return next(
        new ErrorHandler("Your account is banned. Please contact support.", 400)
      );

    req.user = decodedData._id;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return next(new ErrorHandler("Invalid token", 401));
    } else if (error.name === "TokenExpiredError") {
      return next(new ErrorHandler("Token has expired", 401));
    }
    return next(new ErrorHandler("Authentication failed", 500));
  }
});

const adminOnly = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User Not Found", 404));

  if (user.role !== "admin")
    return next(new ErrorHandler("Unauthorized Access", 403));

  next();
});

const superAdminOnly = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User Not Found", 404));

  if (user.role !== "super_admin")
    return next(new ErrorHandler("Unauthorized Access", 403));

  next();
});

const adminOrSuperAdmin = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User Not Found", 404));

  if (user.role !== "super_admin" && user.role !== "admin")
    return next(new ErrorHandler("Unauthorized Access", 403));

  next();
});

export { adminOnly, adminOrSuperAdmin, isAuthenticated, superAdminOnly };
