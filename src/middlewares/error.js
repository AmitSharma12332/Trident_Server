export const errorMiddleware = (err, req, res, next) => {
  err.message ||= "Internal Server Error";
  err.statusCode ||= 500;

  if (process.env.NODE_ENV === "development") {
    console.error(err);
  }

  return res.status(err.statusCode).json({
    success: false,
    message: err.message,
    ...(process.env.NODE_ENV === "development" ? { stack: err.stack } : {}),
  });
};

export const TryCatch = (func) => (req, res, next) => {
  return Promise.resolve(func(req, res, next)).catch(next);
};
