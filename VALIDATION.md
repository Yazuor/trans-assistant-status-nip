# Weryfikacja 1.0.0 — 4 listopada 2026

Sprawdzono składnię skryptu oraz wykonano test w izolowanym Chrome. Pozostałe moduły Trans Assistant i Bridge nie były załadowane.

Test uruchamia dwie karty intranetu i kilka okien rozmów na odrębnych originach. Sprawdza:

- prawidłowy NIP i izolację obcych rozmów, w tym „Inne” bez frachtu;
- role klient/przewoźnik, obie role i blokadę klienta;
- brak firmy w obu bazach oraz osobny stan błędu przy stronie logowania;
- kopiowanie samego NIP-u i ręczne odświeżenie prawym przyciskiem;
- pięciominutowy cache bez ponownego zapytania o ten sam NIP;
- obsługę jednego zapytania przez jedną z dwóch kart intranetu;
- zachowanie natywnego kroku wyboru klienta z przyciskiem „Wybierz”, bez zapisu oferty;
- usuwanie ramek roboczych i odrzucenie spóźnionej odpowiedzi po zmianie rozmowy.
- przechwytywanie znanego modułu usług Messengera bez zmiany zwracanego Promise oraz odczyt Observable z odsubskrybowaniem;
- osobny komunikat po przekroczeniu czasu oczekiwania przy braku karty intranetu.

**Transport GM i odpowiedzi Trans.eu/intranetu są w teście symulowane.** Test potwierdza logikę i wygląd, ale nie jest potwierdzeniem działania w rzeczywistej instalacji Tampermonkey u odbiorcy. Mechanizm rozpoznawania runtime i sprawdzania formularzy pochodzi z używanego Trans Assistant. Po instalacji należy sprawdzić znanego klienta, przewoźnika i blokadę na rzeczywistym intranecie.

Kod nie zawiera kluczy API, haseł, ciasteczek, danych prawdziwych rozmów ani adresu lokalnego Bridge.
