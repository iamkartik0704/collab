-- Adds an in-flight delivery state. The worker writes SENDING *before* calling the provider, so a
-- retry whose previous attempt may already have been accepted (timeout, crash) can stop instead of
-- sending a duplicate WhatsApp message.
--
-- Kept in its own migration on purpose: PostgreSQL cannot add an enum value and use it in the same
-- transaction, and Prisma runs each migration file in a transaction.
ALTER TYPE "NotificationStatus" ADD VALUE 'SENDING';
