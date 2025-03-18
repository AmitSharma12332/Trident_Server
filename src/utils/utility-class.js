class ErrorHandler extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;

    if (process.env.NODE_ENV === "development") {
      console.error(this.stack);
    }
  }
}

export { ErrorHandler };
