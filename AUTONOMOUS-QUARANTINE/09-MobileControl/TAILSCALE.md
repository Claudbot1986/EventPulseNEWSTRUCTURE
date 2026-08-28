# Tailscale Setup for Mobile Control

Tailscale ger en krypterad privat tunnel från din telefon till din Mac —
utan att exponera portar mot publikt internet.

## Vad det ger

- Privat nät (100.x.x.x-adresser) endast du kan nå
- Krypterad transport (WireGuard)
- IP-baserad auktorisering + magic DNS
- Fungerar över mobilnät/WiFi från vilken plats som helst
- Ingen publik port forward, ingen brandväggskonfig

## Installera Tailscale

### På din Mac (värden)

1. Ladda ner: https://tailscale.com/download/mac
2. Logga in med samma konto som på telefonen
3. Verifiera: `tailscale ip -4` ska ge en 100.x.x.x-adress

### På din telefon

1. Installera Tailscale-appen (iOS/Android)
2. Logga in med **samma konto**
3. Slå på Tailscale
4. Din Mac syns nu i Tailscale-appen som "eventpulse-mac" eller liknande

## Starta mobile control-servern

På din Mac:

```bash
bash scripts/start-mobile-control.sh
```

Första gången genererar scriptet en `MOBILE_CONTROL_TOKEN` (64 hex) och
skriver den till `.env.mobile` (mode 600). Servern startar på
`127.0.0.1:8788`.

## Hitta din Tailscale-IP

```bash
tailscale ip -4
```

Returnerar t.ex. `100.64.1.42`.

## Öppna dashboarden på telefonen

I Tailscale-appen på telefonen, öppna Safari/Chrome och gå till:

```
http://100.64.1.42:8788/?token=<din token från .env.mobile>
```

Token sparas i `localStorage` efter första besöket, så framtida besök
behöver inte token i URL:en.

## Säkerhetsmodell

- **Autentisering:** Bearer-token, validerad av `requireToken`-middleware
- **Transport:** WireGuard-krypterad (Tailscale)
- **Bind:** `127.0.0.1` default → endast Tailscale-interfacet når servern
- **Inga publika portar:** Tailscale öppnar inga portar mot internet
- **Token-rotating:** Token sparas i `.env.mobile` (gitignored). Generera
  ny genom att radera filen och köra `start-mobile-control.sh` igen

## Felsökning

| Symptom | Orsak | Åtgärd |
|---------|-------|--------|
| Telefon hittar inte servern | Tailscale inte på på telefonen | Slå på Tailscale, logga in |
| 401 unauthorized | Token fel/saknas | Kontrollera `?token=...` i URL |
| `tmux not installed` | tmux saknas | `brew install tmux` |
| `connection refused` | Servern kör inte | Kör `start-mobile-control.sh` på Mac |
| Token sparat fel i `.env.mobile` | Fil skadad | Radera filen, kör om `start-mobile-control.sh` |

## Avancerat: ACL

Tailscale ACL kan begränsa vilka enheter som får nå varandra. Default
delar du allt med dig själv — funkar för enskild användare. För flera
användare eller delning med andra, konfigurera ACL i
https://login.tailscale.com/admin/acls.

Exempel på ACL som bara tillåter din telefon → din Mac:

```json
{
  "acls": [
    {
      "action": "accept",
      "src": ["tag:phone"],
      "dst": ["tag:mac:8788"]
    }
  ],
  "tagOwners": {
    "tag:phone": ["autogroup:member"],
    "tag:mac":   ["autogroup:member"]
  }
}
```

Lägg till taggar på dina enheter under
https://login.tailscale.com/admin/machines.

## Varför inte bara ngrok / Cloudflare Tunnel?

- ngrok: kräver publik URL, auth via URL-token (synligt i logs), gratis-tier
  har bandbreddstak
- Cloudflare Tunnel: kräver Cloudflare-konto + domän, mer komplext
- Tailscale: zero-config för personligt bruk, inga publik synliga endpoints,
  inga rate limits, inga tier-begränsningar

För personligt bruk är Tailscale klart överlägset i användarvänlighet
samtidigt som det ger WireGuard-kryptering gratis.