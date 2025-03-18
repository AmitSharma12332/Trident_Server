import mongoose, { Schema, model } from "mongoose";

const schema = new Schema(
  {
    title: {
      type: String,
      required: true,
    },
    image: {
      public_id: {
        type: String,
        required: true,
      },
      url: {
        type: String,
        required: true,
      },
    },
  },
  {
    timestamps: true,
  }
);

export const Carousel = mongoose.models.Carousel || model("Carousel", schema);
