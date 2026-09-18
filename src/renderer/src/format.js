// Format monetar uniform in toata aplicatia: separator de mii (spatiu
// insecabil) si virgula zecimala, ex. "1 250,00". Valorile raman numere
// in stare/calcule - doar afisarea se formateaza.
export function formatMoney(value) {
  const n = Number(value)
  const safe = Number.isFinite(n) ? n : 0
  const [int, dec] = Math.abs(safe).toFixed(2).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${safe < 0 ? '-' : ''}${grouped},${dec}`
}

export function formatLei(value) {
  return `${formatMoney(value)} lei`
}
