const DDDS_VALIDOS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

export function normalizarTelefoneBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/\D/g, "");

  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;

  const ddd = Number(d.slice(0, 2));
  if (!DDDS_VALIDOS.has(ddd)) return null;

  let numero = d.slice(2);

  if (numero.length === 8) {
    const primeiro = numero[0];
    // 6-9 => celular antigo, faltando o nono digito.
    // 2-5 => fixo, NUNCA ganha o 9 (corromperia o ID do contato no NexTags).
    if (primeiro >= "6" && primeiro <= "9") numero = "9" + numero;
    else if (primeiro < "2") return null;
  }

  if (numero.length === 9 && numero[0] !== "9") return null;

  return `55${d.slice(0, 2)}${numero}`;
}
