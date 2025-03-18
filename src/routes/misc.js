import express from "express";
import { dltImage, getImages, uploadImage } from "../controllers/misc.js";
import { isAuthenticated, superAdminOnly } from "../middlewares/auth.js";
import { singleImage } from "../middlewares/multer.js";

const app = express.Router();

app.get("/get-images", getImages);

app.use(isAuthenticated);

app.post("/add-image", superAdminOnly, singleImage, uploadImage);

app.delete("/dlt-image/:id", superAdminOnly, dltImage);

export default app;
