import mongoose, { Schema, model } from "mongoose";

const schema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      ref: "User",
    },
    parentUser: {
      type: String,
      required: true,
      ref: "User",
    },
    accNo: {
      type: String,
      required: true,
    },
    ifsc: {
      type: String,
      required: true,
    },
    bankName: {
      type: String,
      required: true,
    },
    receiverName: {
      type: String,
      required: true,
    },
    contact: {
      type: String,
      required: true,
      match: [/^\d{10}$/, "Invalid contact number"],
    },
    amount: {
      type: Number,
      required: true,
      min: 100,
    },
    status: {
      type: String,
      enum: ["approved", "rejected", "pending"],
      default: "pending",
    },
  },
  {
    timestamps: true,
  }
);

export const WithdrawHistory =
  mongoose.models.WithdrawHistory || model("WithdrawHistory", schema);
