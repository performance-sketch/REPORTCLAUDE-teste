#!/usr/bin/env python3
"""
gerar_slots.py — dados do "Calendário de Voos" (data/slots.json)

Agrupa as reservas CONFIRMADAS do Rezdy por slot de voo (data + horário local + produto) e,
quando a API de disponibilidade responde, junta a capacidade de cada sessão (seats / seatsAvailable).
O calendario.js monta as visões de ano, mês e semana no navegador.

Regras:
  - Data e horário do slot = startTimeLocal do item da reserva (horário local do produto).
  - PAX = soma das quantidades do item (mesma regra da comparação de períodos).
  - Pedidos duplicados contam uma vez (orderNumber). Sem nome, e-mail ou documento do cliente.

Formato de cada linha em "s":
  [data, "HH:MM", produto, pax, reservas, lugares, livres]
    produto: índice de "produtos"
    lugares / livres: capacidade da sessão no Rezdy (null quando não houver sessão cadastrada)

Variável de ambiente: REZDY_API_KEY (ou REZDY_KEY)
"""

import json
import os
import pathlib
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta

import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import log_seguro  # noqa: E402 — esconde a chave da API em qualquer mensagem (logs públicos)
from gerar_comparacao import BRT, buscar, pax_item  # noqa: E402

log_seguro.ativar()

ROOT = pathlib.Path(__file__).resolve().parent.parent
SAIDA = ROOT / "data" / "slots.json"
RESERVAS_DESDE = "2024-11-01"     # criadas a partir daqui → cobre os voos de 2025 em diante
VOOS_DESDE = "2025-01-01"
DIAS_FUTURO = 180                 # sessões futuras buscadas na API de disponibilidade
SEM_SESSAO = ("gift card", "no-show", "shuttle")   # produtos que não são voo


def get(api_key, caminho, params):
    for tentativa in range(5):
        r = requests.get(f"https://api.rezdy.com/v1/{caminho}",
                         params={"apiKey": api_key, **params}, timeout=30)
        if r.status_code == 429:
            time.sleep(2 ** tentativa * 2)
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()


def sessoes(api_key, codigo, ini, fim):
    """Sessões de um produto entre ini e fim (datas ISO), em janelas de 1 mês."""
    todas, cur = [], date.fromisoformat(ini)
    fim_d = date.fromisoformat(fim)
    while cur <= fim_d:
        prox = min(date(cur.year + (cur.month == 12), cur.month % 12 + 1, 1), fim_d + timedelta(days=1))
        offset = 0
        while True:
            lote = get(api_key, "availability", {
                "productCode": codigo, "limit": 100, "offset": offset,
                "startTimeLocal": f"{cur.isoformat()} 00:00:00",
                "endTimeLocal": f"{(prox - timedelta(days=1)).isoformat()} 23:59:59",
            }).get("sessions") or []
            todas.extend(lote)
            time.sleep(0.7)       # limite da API: ~100 requisições/minuto
            if len(lote) < 100:
                break
            offset += 100
        cur = prox
    return todas


def main():
    api_key = os.environ.get("REZDY_API_KEY") or os.environ.get("REZDY_KEY")
    if not api_key:
        sys.exit("Defina REZDY_API_KEY")

    produtos, codigos = [], {}
    idx = lambda nome: produtos.index(nome) if nome in produtos else (produtos.append(nome) or len(produtos) - 1)
    slots = defaultdict(lambda: [0, 0, None, None])     # (data, hora, produto) → [pax, reservas, lugares, livres]
    vistos = set()

    for b in buscar(api_key, RESERVAS_DESDE):
        n = b.get("orderNumber") or ""
        if not n or n in vistos or b.get("status") != "CONFIRMED":
            continue
        vistos.add(n)
        for it in b.get("items") or []:
            ini = it.get("startTimeLocal") or ""
            pax = pax_item(it)
            if len(ini) < 16 or ini[:10] < VOOS_DESDE or not pax:
                continue
            nome = it.get("productName") or "?"
            if it.get("productCode"):
                codigos[it["productCode"]] = nome
            s = slots[(ini[:10], ini[11:16], idx(nome))]
            s[0] += pax
            s[1] += 1

    # Capacidade das sessões (opcional: se a API de disponibilidade falhar, segue só com as reservas)
    fim = (datetime.now(BRT).date() + timedelta(days=DIAS_FUTURO)).isoformat()
    n_sessoes = 0
    for codigo, nome in sorted(codigos.items()):
        if any(x in nome.lower() for x in SEM_SESSAO):
            continue
        try:
            lista = sessoes(api_key, codigo, VOOS_DESDE, fim)
        except requests.RequestException as e:
            print(f"Aviso: disponibilidade de {nome} indisponível ({e.__class__.__name__}); seguindo sem capacidade")
            continue
        for se in lista:
            ini = se.get("startTimeLocal") or ""
            if len(ini) < 16 or se.get("seats") is None:
                continue
            s = slots[(ini[:10], ini[11:16], idx(nome))]
            s[2] = (s[2] or 0) + int(se.get("seats") or 0)
            s[3] = (s[3] or 0) + int(se.get("seatsAvailable") or 0)
            n_sessoes += 1

    linhas = sorted([[d, h, p, *v] for (d, h, p), v in slots.items()])
    SAIDA.parent.mkdir(exist_ok=True)
    SAIDA.write_text(json.dumps({
        "gerado_em": datetime.now(BRT).isoformat(timespec="minutes"), "desde": VOOS_DESDE,
        "produtos": produtos, "s": linhas,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    pax = sum(x[3] for x in linhas)
    print(f"slots.json: {len(linhas)} slots · {pax} pax · {n_sessoes} sessões com capacidade · {SAIDA.stat().st_size / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
