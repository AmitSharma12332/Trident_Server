import mongoose, { Schema, model } from "mongoose";

const schema = new Schema(
  {
    userId: {
      type: String,
      required: true,
      ref: "User",
    },
    eventId: {
      type: String,
      required: true,
    },
    marketId: {
      type: String,
      required: true,
    },
    selectionId: {
      type: String,
      required: true,
    },
    fancyNumber: {
      type: String,
      default: null,
    },
    profit: {
      type: Number,
      required: true,
    },
    loss: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Margin = mongoose.models.Margin || model("Margin", schema);
