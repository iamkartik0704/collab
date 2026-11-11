-- Records WhatsApp STOP replies so marketing jobs (abandoned-cart reminders) can skip those customers.
ALTER TABLE "NotificationPreference" ADD COLUMN "whatsappOptOutAt" TIMESTAMPTZ(3);
