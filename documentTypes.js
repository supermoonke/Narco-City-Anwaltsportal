/**
 * documentTypes.js
 * ----------------------------------------------------------------------
 * Zentrale Liste der Dokumenttypen — geteilt zwischen Template-Seeding
 * und der serverseitigen Validierung neuer Dokumente. Muss inhaltlich
 * mit der Kopie im Frontend (js/app.js, DOCUMENT_TYPES) übereinstimmen.
 * ----------------------------------------------------------------------
 */

const DOCUMENT_TYPES = [
  {
    id: "aktenwiderspruch",
    label: "Aktenwiderspruch",
    aufbau: ["Rubrum (Gericht, Aktenzeichen, Parteien)", "Anfechtungsantrag", "Begründung: Sachverhalt & rechtliche Würdigung", "Schlussformel & Unterschrift"]
  },
  {
    id: "widerspruch-festnahme",
    label: "Widerspruch gegen Festnahme",
    aufbau: ["Rubrum & Bezug zur Festnahme", "Darstellung des Festnahmeverlaufs", "Rechtliche Würdigung der Rechtmäßigkeit", "Antrag"]
  },
  {
    id: "haftentlassung",
    label: "Antrag auf Haftentlassung",
    aufbau: ["Rubrum", "Antrag auf Haftentlassung", "Begründung (Fluchtgefahr, Verhältnismäßigkeit)", "Hilfsanträge (Auflagen)"]
  },
  {
    id: "klageschrift",
    label: "Klageschrift",
    aufbau: ["Rubrum (Parteien, Az.)", "Klageantrag", "Sachverhalt", "Rechtliche Begründung", "Beweismittel"]
  },
  {
    id: "beschwerde",
    label: "Beschwerde",
    aufbau: ["Rubrum & angefochtene Entscheidung", "Beschwerdeantrag", "Begründung", "Schlussformel"]
  },
  {
    id: "vollmacht",
    label: "Vollmacht",
    aufbau: ["Vollmachtgeber & Bevollmächtigter", "Umfang der Vollmacht", "Ort, Datum, Unterschrift"]
  },
  {
    id: "vergleich",
    label: "Einigung / Vergleich",
    aufbau: ["Parteien", "Gegenstand der Einigung", "Vereinbarte Regelung", "Schlussbestimmungen"]
  },
  {
    id: "sonstiges",
    label: "Sonstige Dokumente",
    aufbau: ["Aufbau frei nach Vorlage — im Sachverhalt beschreiben"]
  }
];

const CASE_STATUS_VALUES = ["offen", "in_bearbeitung", "abgeschlossen"];

module.exports = { DOCUMENT_TYPES, CASE_STATUS_VALUES };
