import type { Metadata } from "next";
import BillingWorkspace from "@/components/billing-workspace";
import "./billing.css";

export const metadata: Metadata = { title: "Plans & credits", robots: { index: false, follow: false } };

export default function BillingPage() {
  // Replace this explicit unavailable state with an authenticated, server-owned
  // billing summary. Never infer account balances from local workspace data.
  return <BillingWorkspace summary={{ status: "unavailable", unit: "whole_customer_credits", available: null, reserved: null, used: null, period: null, entries: [] }} />;
}
