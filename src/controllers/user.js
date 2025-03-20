import { compare } from "bcrypt";
import mongoose from "mongoose";
import { TryCatch } from "../middlewares/error.js";
import { Bet } from "../models/bet.js";
import { Margin } from "../models/margin.js";
import { PaymentHistory } from "../models/paymentHistory.js";
import { User } from "../models/user.js";
import { WithdrawHistory } from "../models/withdrawHistory.js";
import { sendToken } from "../utils/features.js";
import { calculateTotalExposure } from "../utils/helper.js";
import { ErrorHandler } from "../utils/utility-class.js";

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

  const validRoles = ["user", "master"];
  if (!validRoles.includes(role.toLowerCase()))
    return next(new ErrorHandler("Invalid role", 400));

  let user = await User.findOne({ email });
  if (user) return next(new ErrorHandler("Account already exists", 400));

  if (parentUser.role === "master") {
    if (parentUser.status === "banned")
      return next(new ErrorHandler("You can't perform this action", 400));

    const exposure = await calculateTotalExposure(parentUser._id);
    if (parentUser.amount - exposure < amount)
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

  const isMatch = await compare(password, user.password);
  if (!isMatch)
    return next(new ErrorHandler("Invalid Username or Password", 404));

  sendToken(res, user, 200, `Welcome Back, ${user.name}`);
});

const changePassword = TryCatch(async (req, res, next) => {
  const { oldPassword, newPassword } = req.body;

  const user = await User.findById(req.user).select("+password");
  if (!user) return next(new ErrorHandler("User Not Found", 404));

  if (!oldPassword || !newPassword)
    return next(new ErrorHandler("Old and new password are required", 400));

  const isMatch = await compare(oldPassword, user.password);
  if (!isMatch) return next(new ErrorHandler("Invalid old password", 400));

  if (newPassword.length < 6)
    return next(new ErrorHandler("Password too short (min 6 chars)", 400));

  user.password = newPassword;
  await user.save();

  return res.status(200).json({
    success: true,
    message: "Password changed successfully",
  });
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

  const adjustAmount = async (users) => {
    return Promise.all(
      users.map(async (u) => {
        const exposure = await calculateTotalExposure(u._id);
        return {
          ...u,
          exposure,
          amount: u.status === "banned" ? 0 : u.amount - exposure,
        };
      })
    );
  };

  let result;

  if (user.role === "super_admin") {
    const admins = await User.find({ role: "master" }).lean();
    const adminIds = admins.map((admin) => admin._id);

    let users = await User.find({ parentUser: { $in: adminIds } }).lean();
    users = await adjustAmount(users);

    result = await Promise.all(
      admins.map(async (admin) => {
        const exposure = await calculateTotalExposure(admin._id);
        return {
          admin: {
            ...admin,
            exposure,
            amount: admin.status === "banned" ? 0 : admin.amount - exposure,
          },
          users: users.filter(
            (u) => String(u.parentUser) === String(admin._id)
          ),
        };
      })
    );
  } else if (user.role === "master") {
    let users = await User.find({ parentUser: user._id }).lean();
    users = await adjustAmount(users);
    result = users;
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
    if (targetUser.role !== "master") {
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
  } else if (requestingUser.role === "master") {
    if (
      targetUser.role !== "user" ||
      targetUser.parentUser.toString() !== requestingUser._id.toString()
    ) {
      return next(
        new ErrorHandler("Admins can only ban/unban users they created", 403)
      );
    }

    if (requestingUser.status === "banned")
      return next(new ErrorHandler("You can't perform this operation", 400));

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
    if (targetUser.role !== "master") {
      return next(
        new ErrorHandler("Super Admin can add money only to Master", 403)
      );
    }
  } else if (requester.role === "master") {
    if (
      targetUser.role !== "user" ||
      targetUser.parentUser.toString() !== requester._id.toString()
    ) {
      return next(
        new ErrorHandler("Master can add money only to their own users", 403)
      );
    }

    if (requester.status === "banned")
      return next(new ErrorHandler("You can't perform this operation", 400));

    const exposure = await calculateTotalExposure(requester._id);
    if (requester.amount - exposure < amount)
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

const reduceAmount = TryCatch(async (req, res, next) => {
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

  const exposure = await calculateTotalExposure(targetUser._id);
  if (targetUser.amount - exposure < amount)
    return next(new ErrorHandler("Target user has insufficient balance", 400));

  if (requester.role === "super_admin") {
    if (targetUser.role !== "master") {
      return next(
        new ErrorHandler("Super Admin can add money only to Master", 403)
      );
    }
  } else if (requester.role === "master") {
    if (
      targetUser.role !== "user" ||
      targetUser.parentUser.toString() !== requester._id.toString()
    ) {
      return next(
        new ErrorHandler("Master can add money only to their own users", 403)
      );
    }

    if (requester.status === "banned")
      return next(new ErrorHandler("You can't perform this operation", 400));

    requester.amount += amount;
    await requester.save();
  } else {
    return next(new ErrorHandler("Unauthorized action", 403));
  }

  targetUser.amount -= amount;
  await targetUser.save();

  await PaymentHistory.create({
    userId: targetUser._id,
    userName: targetUser.name,
    currency: targetUser.currency,
    amount: amount * -1,
  });

  return res.status(200).json({
    success: true,
    message: `${amount} Reduce successfully`,
    user: targetUser,
  });
});

const deleteUser = TryCatch(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id))
    return next(new ErrorHandler("Invalid User ID", 400));

  const requester = await User.findById(req.user);
  if (!requester) return next(new ErrorHandler("Unauthorized", 401));

  const targetUser = await User.findById(id);
  if (!targetUser) return next(new ErrorHandler("User Not Found", 404));

  const deleteRelatedData = async (userId) => {
    await Promise.all([
      Bet.deleteMany({ userId }),
      Margin.deleteMany({ userId }),
      PaymentHistory.deleteMany({ userId }),
      WithdrawHistory.deleteMany({ userId }),
    ]);
  };

  if (requester.role === "super_admin") {
    if (targetUser.role !== "master")
      return next(new ErrorHandler("Super Admin can delete only Masters", 403));

    const users = await User.find({ parentUser: targetUser._id });
    await Promise.all(users.map((user) => deleteRelatedData(user._id)));
    await User.deleteMany({ parentUser: targetUser._id });

    await deleteRelatedData(targetUser._id);
    await User.findByIdAndDelete(targetUser._id);
  } else if (requester.role === "master") {
    if (
      targetUser.role !== "user" ||
      String(targetUser.parentUser) !== String(requester._id)
    )
      return next(
        new ErrorHandler("Master can delete only their own users", 403)
      );

    requester.amount += targetUser.amount;
    await requester.save();

    await deleteRelatedData(targetUser._id);
    await User.findByIdAndDelete(targetUser._id);
  } else {
    return next(new ErrorHandler("Unauthorized Action", 403));
  }

  return res.status(200).json({
    success: true,
    message:
      requester.role === "super_admin"
        ? `Master and its users deleted successfully`
        : "User deleted and balance transferred to master",
  });
});

export {
  addAmount,
  changePassword,
  changeUserStatus,
  deleteUser,
  getAllUsers,
  getMyProfile,
  login,
  newUser,
  reduceAmount,
};
