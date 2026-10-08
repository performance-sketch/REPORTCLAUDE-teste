#!/usr/bin/env python3
"""
gerar_comparacao.py — dados da "Comparação Personalizada de Períodos" (data/comparacao.json)

Busca as reservas do Rezdy desde COMPARACAO_DESDE e grava uma linha compacta por pedido
(sem nome, e-mail ou documento do cliente). O comparacao.js recalcula tudo no navegador.

Regras:
  - Booking Date (d) = data de criação da reserva, em horário de Brasília → análises de vendas.
  - Fulfilment Date (t, por item) = data do voo → análises de voos.
  - Pedidos duplicados contam uma vez (orderNumber).
  - Canal: ONLINE → O, INTERNAL → I, MARKETPLACE_PREF_RATE (Negotiated Rate / GetYourGuide) → N.

Formato de cada linha em "b":
  [n, d, s, c, v]                              — reservas não confirmadas
  [n, d, s, c, v, com, pagamentos, itens]      — confirmadas
    s: C confirmada · A carrinho abandonado · X cancelada · H on hold · O outros
    pagamentos: {tipo: valor}  (PAYPAL, CREDITCARD, FREE = cortesia/FOC, PROMO_CODE, REFUND, ...)
    itens: [[produto, data_do_voo, duracao_min, pax, [[extra, qtd, receita], ...], valor_do_item], ...]
           produto e extra são índices de "produtos" e "extras".

Variável de ambiente: REZDY_API_KEY (ou REZDY_KEY)
"""

import json
import os
import pathlib
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import log_seguro  # noqa: E402 — esconde a chave da API em qualquer mensagem (logs públicos)

log_seguro.ativar()

ROOT = pathlib.Path(__file__).resolve().parent.parent
SAIDA = ROOT / "data" / "comparacao.json"
COMPARACAO_DESDE = "2025-01-01"
BRT = timezone(timedelta(hours=-3))
STATUS = {"CONFIRMED": "C", "ABANDONED_CART": "A", "CANCELLED": "X", "ON_HOLD": "H"}
CANAL = {"ONLINE": "O", "INTERNAL": "I", "MARKETPLACE_PREF_RATE": "N"}


def data_brt(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(BRT).date().isoformat()
    except (ValueError, AttributeError):
        return (iso or "")[:10]


def buscar(api_key, desde):
    todas, offset = [], 0
    while True:
        for tentativa in range(5):
            r = requests.get("https://api.rezdy.com/v1/bookings",
                             params={"apiKey": api_key, "limit": 100, "offset": offset}, timeout=30)
            if r.status_code == 429:
                time.sleep(2 ** tentativa * 2)
                continue
            r.raise_for_status()
            break
        lote = r.json().get("bookings", [])
        if not lote:
            break
        todas.extend(lote)
        if len(lote) < 100 or data_brt(lote[-1].get("dateCreated") or "") < desde:
            break
        offset += 100
        time.sleep(0.7)       # limite da API: ~100 requisições/minuto
    return todas


def duracao_min(item):
    try:
        a = datetime.fromisoformat(item["startTime"].replace("Z", "+00:00"))
        z = datetime.fromisoformat(item["endTime"].replace("Z", "+00:00"))
        return max(0, round((z - a).total_seconds() / 60))
    except (KeyError, ValueError, AttributeError, TypeError):
        return None


def pax_item(item):
    return sum(int(q.get("value") or 0) for q in item.get("quantities") or []) or int(item.get("totalQuantity") or 0)


def receita_extra(e):
    preco, qtd = float(e.get("price") or 0), int(e.get("quantity") or 0)
    # QUANTITY: preço por unidade; demais tipos: preço do extra inteiro
    return round(preco * qtd if (e.get("extraPriceType") or "").upper() == "QUANTITY" else preco, 2)


def main():
    api_key = os.environ.get("REZDY_API_KEY") or os.environ.get("REZDY_KEY")
    if not api_key:
        sys.exit("Defina REZDY_API_KEY")
    brutas = buscar(api_key, COMPARACAO_DESDE)
    produtos, extras, linhas, vistos = [], [], [], set()
    idx = lambda lista, nome: lista.index(nome) if nome in lista else (lista.append(nome) or len(lista) - 1)

    for b in brutas:
        n = b.get("orderNumber") or ""
        d = data_brt(b.get("dateCreated") or "")
        if not n or n in vistos or d < COMPARACAO_DESDE:
            continue
        vistos.add(n)
        s = STATUS.get(b.get("status"), "O")
        c = CANAL.get((b.get("source") or "ONLINE").upper(), "?")
        v = round(float(b.get("totalAmount") or 0), 2)
        if s != "C":
            linhas.append([n, d, s, c, v])
            continue
        pag = {}
        for p in b.get("payments") or []:
            t = (p.get("type") or "OTHER").upper()
            pag[t] = round(pag.get(t, 0) + abs(float(p.get("amount") or 0)), 2)
        itens = []
        for it in b.get("items") or []:
            ex = [[idx(extras, e.get("name") or "?"), int(e.get("quantity") or 0), receita_extra(e)]
                  for e in it.get("extras") or [] if int(e.get("quantity") or 0) > 0]
            itens.append([idx(produtos, it.get("productName") or "?"), (it.get("startTimeLocal") or "")[:10],
                          duracao_min(it), pax_item(it), ex, round(float(it.get("amount") or it.get("subtotal") or 0), 2)])
        linhas.append([n, d, s, c, v, round(float(b.get("commission") or 0), 2), pag, itens])

    linhas.sort(key=lambda x: x[1])
    SAIDA.parent.mkdir(exist_ok=True)
    SAIDA.write_text(json.dumps({
        "gerado_em": datetime.now(BRT).isoformat(timespec="minutes"), "desde": COMPARACAO_DESDE,
        "produtos": produtos, "extras": extras, "b": linhas,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    conf = sum(1 for x in linhas if x[2] == "C")
    print(f"comparacao.json: {len(linhas)} pedidos ({conf} confirmados) desde {COMPARACAO_DESDE} · {SAIDA.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
