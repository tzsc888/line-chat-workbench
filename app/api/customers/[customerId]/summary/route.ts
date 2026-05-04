import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { customerListSelect, mapCustomerListItem } from "@/app/api/customers/customer-list-shared";

type Props = {
  params: Promise<{ customerId: string }>;
};

export async function GET(_: Request, { params }: Props) {
  try {
    const { customerId } = await params;
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: customerListSelect,
    });

    if (!customer) {
      return NextResponse.json({ ok: false, error: "customer_not_found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      customer: mapCustomerListItem(customer, Date.now()),
    });
  } catch (error) {
    console.error("GET /api/customers/[customerId]/summary error:", error);
    return NextResponse.json({ ok: false, error: "failed_to_load_customer_summary" }, { status: 500 });
  }
}

