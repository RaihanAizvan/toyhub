import nodemailer from "nodemailer";
import { readEnv } from "./config.js";

let injectedTransport = null;

const buildTransport = () =>
  nodemailer.createTransport({
    service: readEnv("MAIL_SERVICE") || "gmail",
    auth: {
      user: readEnv("MAIL_USER"),
      pass: readEnv("MAIL_PASSWORD"),
    },
  });

const getTransport = () => {
  if (!injectedTransport) {
    injectedTransport = buildTransport();
  }
  return injectedTransport;
};

export const setMailTransport = (transport) => {
  injectedTransport = transport;
};

export const resetMailTransport = () => {
  injectedTransport = null;
};

export const sendMail = async ({ to, subject, text, html }) => {
  const info = await getTransport().sendMail({
    from: readEnv("MAIL_FROM"),
    to,
    subject,
    text,
    html,
  });
  return info;
};
