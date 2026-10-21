import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { emperors } from "../src/db/schema";

/**
 * Llena sin límite el depósito de un Emperador en la base de datos de las
 * pruebas: en el Núcleo Humano dos jugadores pueden aparecer más lejos de lo
 * que alcanza un salto con el depósito lleno (el alcance tiene su propia prueba
 * en el servidor).
 */
export async function unlimitedFuel(emperorId: string): Promise<void> {
  const url = process.env.E2E_DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Falta E2E_DATABASE_URL");
  const database = createDb(url);
  try {
    await database.db.update(emperors).set({ fuel: 1e6, fuelAt: new Date() }).where(eq(emperors.id, emperorId));
  } finally {
    await database.close();
  }
}
