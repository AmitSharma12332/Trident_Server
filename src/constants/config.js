// export const corsOption = {
//   origin: [
//     "http://localhost:5173",
//     "https://localhost:4173",
//     "https://gaming-app-client.vercel.app/",
//     process.env.CLIENT_URL,
//   ],
//   methods: ["GET", "POST", "PUT", "DELETE"],
//   credentials: true,
// };

export const corsOption = {
  // origin: ["https://www.shaktiex.com", "http://localhost:5173"],
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
};
