/** @jsxRuntime automatic */
import type { TransactionalEmail } from "@mycellios/adapter-kit";
import { productBrand } from "@mycellios/contracts";
import { displayName } from "@mycellios/core";
import { lightTokens } from "@mycellios/ui-tokens";
import type { ReactNode } from "react";
import { Body, Container, Head, Html, Link, render, Text, toPlainText } from "react-email";

async function message(
  to: string,
  subject: string,
  content: ReactNode,
): Promise<TransactionalEmail> {
  const html = await render(
    <Html lang="en">
      <Head />
      <Body
        style={{
          backgroundColor: lightTokens.dialog,
          color: lightTokens.foreground,
          fontFamily: "Arial, sans-serif",
        }}
      >
        <Container style={{ maxWidth: "480px", padding: "24px" }}>{content}</Container>
      </Body>
    </Html>,
  );
  return { to, subject, html, text: toPlainText(html) };
}

const linkStyle = { color: lightTokens.primary, textDecoration: "underline" };

export function verificationEmail(email: string, url: string): Promise<TransactionalEmail> {
  return message(
    email,
    `Verify your ${productBrand.shortName} email`,
    <>
      <Text>
        <Link href={url} style={linkStyle}>
          Verify email
        </Link>
      </Text>
      <Text>Then return to {productBrand.shortName} to sign in.</Text>
      <Text>This link expires in one hour. If you did not register, ignore this email.</Text>
    </>,
  );
}

export function signInCodeEmail(email: string, code: string): Promise<TransactionalEmail> {
  return message(
    email,
    `Your ${productBrand.shortName} sign-in code`,
    <>
      <Text>Enter this code to sign in to {productBrand.shortName}:</Text>
      <Text>
        <strong>{code}</strong>
      </Text>
      <Text>This code expires in ten minutes. If you did not request it, ignore this email.</Text>
    </>,
  );
}

export function passwordResetEmail(
  user: { id: string; email: string; name: string },
  resetUrl: string,
): Promise<TransactionalEmail> {
  return message(
    user.email,
    `Reset your ${productBrand.shortName} password`,
    <>
      <Text>Hi {displayName(user.name, "there")},</Text>
      <Text>Reset your {productBrand.shortName} password:</Text>
      <Text>
        <Link href={resetUrl} style={linkStyle}>
          Reset password
        </Link>
      </Text>
      <Text>
        This link expires in one hour. If you did not request this, you can ignore this email.
      </Text>
    </>,
  );
}

/** A one-use invitation to someone's Space. Names stay out of the subject line. */
export function spaceInvitationEmail(
  email: string,
  invitation: { inviterName: string; spaceName: string; url: string },
): Promise<TransactionalEmail> {
  const inviter = displayName(invitation.inviterName, "Someone").slice(0, 80);
  const space = displayName(invitation.spaceName, "a space").slice(0, 60);
  return message(
    email,
    `You are invited to a ${productBrand.shortName} space`,
    <>
      <Text>
        {inviter} invited you to {space} on {productBrand.shortName}.
      </Text>
      <Text>
        <Link href={invitation.url} style={linkStyle}>
          Open invitation
        </Link>
      </Text>
      <Text>
        Sign in with this email address to join. The invitation expires in seven days. If you did
        not expect it, ignore this email.
      </Text>
    </>,
  );
}

export function accountDeletionEmail(email: string, code: string): Promise<TransactionalEmail> {
  return message(
    email,
    `Confirm ${productBrand.shortName} account deletion`,
    <>
      <Text>Enter this code in {productBrand.shortName} to delete your account:</Text>
      <Text>{code}</Text>
      <Text>
        This code expires in ten minutes. If you did not request deletion, ignore this email.
      </Text>
    </>,
  );
}
