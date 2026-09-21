import { PrismaClient } from "@prisma/client";
import berthsData from "../data/berths.json";
import reservationsData from "../data/reservations.json";

const prisma = new PrismaClient();

async function main() {
  console.log(`Seeding ${berthsData.length} berths...`);
  const berthIdByName = new Map<string, string>();

  for (const berth of berthsData) {
    const created = await prisma.berth.upsert({
      where: { name: berth.name },
      update: {
        lengthFt: berth.lengthFt,
        capacity: berth.capacity,
      },
      create: {
        name: berth.name,
        lengthFt: berth.lengthFt,
        capacity: berth.capacity,
      },
    });
    berthIdByName.set(berth.name, created.id);
  }

  console.log(`Seeding ${reservationsData.length} historical reservations...`);
  await prisma.reservation.deleteMany({
    where: { notes: "Imported from 23-year legacy schedule spreadsheet." },
  });

  const BATCH_SIZE = 200;
  for (let i = 0; i < reservationsData.length; i += BATCH_SIZE) {
    const batch = reservationsData.slice(i, i + BATCH_SIZE);
    await prisma.reservation.createMany({
      data: batch.map((r) => ({
        berthId: berthIdByName.get(r.berthName)!,
        occupantName: r.occupantName,
        occupantType: r.occupantType as "VESSEL" | "EVENT",
        vesselLengthFt: r.vesselLengthFt,
        startDate: new Date(r.startDate),
        endDate: new Date(r.endDate),
        notes: r.notes,
      })),
    });
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
