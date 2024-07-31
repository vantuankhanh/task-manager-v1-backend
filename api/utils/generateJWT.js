import jwt from "jsonwebtoken";

export const GenerateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.SECRET_TOKEN, {expiresIn: process.env.EXPIRES_ACCESS_TOKEN});
};

export const GenerateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.SECRET_TOKEN, {expiresIn: process.env.EXPIRES_REFRESH_TOKEN});
};
