# Trans Assistant - Status NIP

Samodzielny skrypt Tampermonkey dla Chrome. Pokazuje w nagłówku rozmowy Trans.eu NIP firmy i jej status w firmowym intranecie. **Nie wymaga Bridge, Node.js, klucza API ani innych modułów Trans Assistant.**

![Podgląd etykiety na danych testowych](preview.png)

## Instalacja

1. Zainstaluj [Tampermonkey dla Chrome](https://www.tampermonkey.net/).
2. Kliknij **[Zainstaluj Status NIP](https://raw.githubusercontent.com/Yazuor/trans-assistant-status-nip/main/trans-assistant-status-nip.user.js)** i zatwierdź instalację.
3. W tym samym profilu Chrome otwórz Trans.eu oraz zalogowany intranet `http://intranet/spedycja_uss_2022/` (lub jego wersję HTTPS).
4. Odśwież obie strony i otwórz rozmowę na Transie. Karta intranetu może działać w tle, ale musi pozostać otwarta.

Nie instaluj jednocześnie tego skryptu i pełnego Trans Assistant na tym samym stanowisku — pełny zestaw ma już własną etykietę NIP. Skrypt samodzielny jest przeznaczony dla osób, które nie używają pozostałych modułów.

## Etykieta

- Ikona osoby: firma jest w intranecie jako klient.
- Ikona ciężarówki: firma jest w intranecie jako przewoźnik.
- Obie ikony: obie role.
- Zielona kropka: znaleziono firmę i nie wykryto blokady klienta.
- Czerwona kropka: intranet zgłasza blokadę klienta.
- Szara kropka: brak dokładnego dopasowania NIP w obu wyszukiwarkach.
- Pomarańczowa kropka: nie udało się sprawdzić; najedź na etykietę, aby odczytać powód. Błąd lub wylogowanie nie są pokazywane jako „brak w bazie”.

Kliknięcie etykiety kopiuje NIP. **Prawy przycisk na etykiecie** ponawia sprawdzenie z pominięciem cache. To samo polecenie jest dostępne w menu Tampermonkey: „Odśwież status NIP w rozmowie”.

## Jak działa

Skrypt odczytuje firmę z natywnego runtime Messengera i NIP z natywnych usług danych firmy. Uwzględnia identyfikator rozmówcy, domenę i kontekst bieżącego okna — także rozmowy „Inne” bez frachtu. Nie odczytuje ani nie wysyła treści rozmów.

Tampermonkey przekazuje żądanie do karty intranetu przez wspólny magazyn tego samego skryptu. Karta intranetu korzysta z istniejących wyszukiwarek klienta i przewoźnika w niewidocznych ramkach. Przy kliencie wykonuje krok wyboru klienta, aby odczytać blokadę; **nie zapisuje oferty ani zlecenia**. Nie zmienia widocznego formularza użytkownika.

Wynik pozostaje w cache przez 5 minut. Upływ tego czasu nie usuwa widocznego statusu z otwartej rozmowy i sam nie uruchamia nowego sprawdzenia. Dopiero następne żądanie odczyta aktualny status; prawy przycisk pomija cache od razu. Nie ma stałego odpytywania serwera podczas bezczynności. Pozostałości żądań są usuwane; do krótkotrwałej komunikacji trafiają tylko NIP, identyfikator zapytania i statusy. Wyłączenie usługi Bridge nie wpływa na ten skrypt.

## Ograniczenia

- Obie strony muszą działać w **tym samym profilu Chrome i tej samej instalacji Tampermonkey**. Osobne profile oraz okna incognito mają osobne dane.
- Wymagany jest dostęp do firmowego hosta `intranet` i działająca sesja logowania.
- Status blokady pochodzi z mechanizmu blokowania **klienta** w intranecie. Nie jest sprawdzeniem podatkowym GUS/VIES ani zewnętrznym sprawdzeniem wiarygodności firmy.
- Układ i usługi wewnętrzne Trans.eu/intranetu mogą się zmieniać. Przy braku danych skrypt nie zgaduje firmy na podstawie koloru lub nazwy.

Wersja 1.0.0. Kod źródłowy znajduje się w jednym pliku `.user.js`; aktualizacje pobiera Tampermonkey z tego repozytorium.
