import type { Metadata } from "next";
import BillingWorkspace from "@/components/billing-workspace";
import { getAccountPrivileges } from "@/lib/account/privileges";
import "./billing.css";

export const metadata: Metadata = { title: "Plans & credits", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [params, accountPrivileges] = await Promise.all([searchParams, getAccountPrivileges()]);
  // Allowance and recorded usage are separate. Keep unverified ledger figures unavailable.
  return <BillingWorkspace accountPrivileges={accountPrivileges} membershipRequired={params.required === "membership"} summary={{ status: "unavailable", unit: "whole_customer_credits", available: null, reserved: null, used: null, period: null, entries: [] }} />;
}
