import { NextResponse } from "next/server";
import { findDataQualityConflicts } from "@/lib/validation";

export async function GET() {
  const conflicts = await findDataQualityConflicts();
  return NextResponse.json(conflicts);
}
