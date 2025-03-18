import { compare } from "bcrypt";
import mongoose from "mongoose";
import { TryCatch } from "../middlewares/error.js";
import { User } from "../models/user.js";
import { sendToken } from "../utils/features.js";
import { ErrorHandler } from "../utils/utility-class.js";
import { PaymentHistory } from "../models/paymentHistory.js";

const newUser = TryCatch(async (req, res, next) => {
  const { name, email, password, currency, role, gender, amount } = req.body;

  if (!name || !email || !password || !currency || !role || !gender || !amount)
    return next(new ErrorHandler("Please enter all fields", 400));

  const parentUser = await User.findById(req.user);
  if (!parentUser) return next(new ErrorHandler("Parent User not found", 404));

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email))
    return next(new ErrorHandler("Invalid email format", 400));

  if (password.length < 6)
    return next(new ErrorHandler("Password too short (min 6 chars)", 400));

  const validRoles = ["user", "admin"];
  if (!validRoles.includes(role.toLowerCase()))
    return next(new ErrorHandler("Invalid role", 400));

  let user = await User.findOne({ email });
  if (user) return next(new ErrorHandler("Account already exists", 400));

  if (parentUser.role === "admin") {
    if (parentUser.amount < amount)
      return next(new ErrorHandler("Insufficient balance", 400));

    parentUser.amount -= amount;
    await parentUser.save();
  }

  user = await User.create({
    name,
    email,
    gender: gender.toLowerCase(),
    amount,
    password,
    currency: currency.toLowerCase(),
    role: role.toLowerCase(),
    parentUser: parentUser._id,
  });

  await PaymentHistory.create({
    userId: user._id,
    userName: user.name,
    currency,
    amount,
  });

  sendToken(res, user, 201, `${role} created successfully`);
});

const login = TryCatch(async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return next(new ErrorHandler("Email and password are required", 400));
  }

  const user = await User.findOne({ email }).select("+password");
  if (!user) return next(new ErrorHandler("Invalid Username or Password", 404));

  if (user.status === "banned")
    return next(
      new ErrorHandler("Your account is banned. Please contact support.", 403)
    );

  const isMatch = await compare(password, user.password);
  if (!isMatch)
    return next(new ErrorHandler("Invalid Username or Password", 404));

  sendToken(res, user, 200, `Welcome Back, ${user.name}`);
});

const getMyProfile = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User Not Found", 404));

  res.status(200).json({
    success: true,
    user,
  });
});

const getAllUsers = TryCatch(async (req, res, next) => {
  const user = await User.findById(req.user);
  if (!user) return next(new ErrorHandler("User Not Found", 404));

  let result;

  if (user.role === "super_admin") {
    const admins = await User.find({ role: "admin" }).lean();
    const adminIds = admins.map((admin) => admin._id);

    const users = await User.find({ parentUser: { $in: adminIds } }).lean();

    result = admins.map((admin) => ({
      admin,
      users: users.filter((u) => String(u.parentUser) === String(admin._id)),
    }));
  } else if (user.role === "admin") {
    result = await User.find({ parentUser: user._id }).lean();
  } else {
    return next(new ErrorHandler("Unauthorized Access", 403));
  }

  return res.status(200).json({
    success: true,
    users: result,
  });
});

const changeUserStatus = TryCatch(async (req, res, next) => {
  const id = req.params.id;
  const { status } = req.body;
  if (!status) return next(new ErrorHandler("Please provide status", 400));

  if (!mongoose.Types.ObjectId.isValid(id))
    return next(new ErrorHandler("Invalid User ID", 400));

  const validStatuses = ["active", "banned"];
  if (!validStatuses.includes(status.toLowerCase()))
    return next(new ErrorHandler("Invalid status value", 400));

  const requestingUser = await User.findById(req.user);
  if (!requestingUser) return next(new ErrorHandler("User not found", 404));

  const targetUser = await User.findById(id);
  if (!targetUser) return next(new ErrorHandler("Invalid ID", 400));

  if (requestingUser.role === "super_admin") {
    if (targetUser.role !== "admin") {
      return next(
        new ErrorHandler("Super admin can only ban/unban admins", 403)
      );
    }
    targetUser.status = status.toLowerCase();
    await targetUser.save();

    // Ban/unban all users created by the admin
    await User.updateMany(
      { parentUser: targetUser._id },
      { $set: { status: status.toLowerCase() } }
    );
  } else if (requestingUser.role === "admin") {
    if (
      targetUser.role !== "user" ||
      targetUser.parentUser.toString() !== requestingUser._id.toString()
    ) {
      return next(
        new ErrorHandler("Admins can only ban/unban users they created", 403)
      );
    }

    if (status.toLowerCase() === "banned")
      requestingUser.amount += targetUser.amount;
    else requestingUser.amount -= targetUser.amount;
    await requestingUser.save();

    targetUser.status = status.toLowerCase();
    await targetUser.save();
  } else {
    return next(new ErrorHandler("Unauthorized access", 403));
  }

  return res.status(200).json({
    success: true,
    message: `User ${status} successfully`,
    user: targetUser,
  });
});

const addAmount = TryCatch(async (req, res, next) => {
  const { id } = req.params;
  const { amount } = req.body;

  if (!amount || isNaN(amount) || amount <= 0)
    return next(new ErrorHandler("Please enter a valid amount", 400));

  if (!mongoose.Types.ObjectId.isValid(id))
    return next(new ErrorHandler("Invalid User ID", 400));

  const requester = await User.findById(req.user);
  if (!requester) return next(new ErrorHandler("Unauthorized", 401));
  if (requester.status === "banned")
    return next(new ErrorHandler("Banned users cannot receive funds.", 400));

  const targetUser = await User.findById(id);
  if (!targetUser) return next(new ErrorHandler("User Not Found", 404));

  if (requester.role === "super_admin") {
    if (targetUser.role !== "admin") {
      return next(
        new ErrorHandler("Super Admin can add money only to Admins", 403)
      );
    }
  } else if (requester.role === "admin") {
    if (
      targetUser.role !== "user" ||
      targetUser.parentUser.toString() !== requester._id.toString()
    ) {
      return next(
        new ErrorHandler("Admin can add money only to their own users", 403)
      );
    }

    if (requester.amount < amount)
      return next(new ErrorHandler("Insufficient balance", 400));

    requester.amount -= amount;
    await requester.save();
  } else {
    return next(new ErrorHandler("Unauthorized action", 403));
  }

  targetUser.amount += amount;
  await targetUser.save();

  await PaymentHistory.create({
    userId: targetUser._id,
    userName: targetUser.name,
    currency: targetUser.currency,
    amount,
  });

  return res.status(200).json({
    success: true,
    message: `${amount} added successfully`,
    user: targetUser,
  });
});

export {
  addAmount,
  changeUserStatus,
  getAllUsers,
  getMyProfile,
  login,
  newUser,
};
