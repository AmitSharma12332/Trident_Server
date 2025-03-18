import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { v2 as cloudinary } from "cloudinary";
import { v4 as uuid } from "uuid";

const connectDB = (uri) => {
  mongoose
    .connect(uri, {
      dbName: "GameApp",
    })
    .then((c) => console.log(`DB connected to ${c.connection.host}`))
    .catch((err) => {
      console.error("Error connecting to MongoDB:", err.message || err);
      process.exit(1);
    });

  // Graceful shutdown of the database connection
  process.on("SIGINT", async () => {
    await mongoose.connection.close();
    console.log("MongoDB connection closed due to app termination");
    process.exit(0);
  });
};

const sendToken = (res, user, code, message) => {
  const token = jwt.sign({ _id: user._id }, process.env.JWT_SECRET);

  return res.status(code).json({
    success: true,
    user,
    message,
    token,
  });
};

const uploadFileToCloudinary = async (file) => {
  const getBase64 = (file) =>
    `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

  try {
    const result = await cloudinary.uploader.upload(getBase64(file), {
      resource_type: "auto",
      public_id: uuid(),
    });

    return {
      public_id: result.public_id,
      url: result.secure_url,
    };
  } catch (error) {
    throw new Error("Error uploading file to Cloudinary: " + error.message);
  }
};

const dltFileFromCloudinary = async (public_id) => {
  try {
    const result = await cloudinary.uploader.destroy(public_id);

    if (result.result === "ok") {
      return {
        success: true,
        message: "File deleted successfully",
      };
    }

    return {
      success: false,
      message: "Failed to delete file",
      cloudinaryResponse: result,
    };
  } catch (error) {
    throw new Error("Error deleting file from Cloudinary: " + error.message);
  }
};

export { connectDB, sendToken, uploadFileToCloudinary, dltFileFromCloudinary };
