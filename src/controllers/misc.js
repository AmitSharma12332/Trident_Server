import { TryCatch } from "../middlewares/error.js";
import { Carousel } from "../models/carousel.js";
import {
  dltFileFromCloudinary,
  uploadFileToCloudinary,
} from "../utils/features.js";
import { ErrorHandler } from "../utils/utility-class.js";

const uploadImage = TryCatch(async (req, res, next) => {
  const { title } = req.body;
  const file = req.file;

  if (!title) return next(new ErrorHandler("Please Enter Title", 400));
  if (!file) return next(new ErrorHandler("Please Upload Image", 400));

  const result = await uploadFileToCloudinary(file);

  if (!result || !result.public_id || !result.url) {
    return next(new ErrorHandler("Image upload failed", 500));
  }

  const image = {
    public_id: result.public_id,
    url: result.url,
  };

  const carousel = await Carousel.create({
    title,
    image,
  });

  return res.status(201).json({
    success: true,
    data: carousel,
  });
});

const getImages = TryCatch(async (req, res, next) => {
  const images = await Carousel.find();

  return res.status(200).json({
    success: true,
    data: images,
  });
});

const dltImage = TryCatch(async (req, res, next) => {
  const { id } = req.params;
  if (!id) return next(new ErrorHandler("Image ID is required", 400));

  const imageData = await Carousel.findById(id);
  if (!imageData) return next(new ErrorHandler("Image not found", 404));

  // Delete from Cloudinary
  const cloudinaryResponse = await dltFileFromCloudinary(
    imageData.image.public_id
  );

  if (!cloudinaryResponse.success) {
    return next(
      new ErrorHandler("Failed to delete image from Cloudinary", 500)
    );
  }

  // Delete from Database
  await Carousel.findByIdAndDelete(id);

  return res.status(200).json({
    success: true,
    message: "Image deleted successfully",
  });
});

export { dltImage, getImages, uploadImage };
