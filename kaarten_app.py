"""
kaarten_app.py — Ed Aldus WM
GUI om waarnemingskaarten te maken voor een gekozen datum.
Start: /usr/local/bin/python3 kaarten_app.py
"""

import tkinter as tk
from tkinter import ttk, messagebox
import subprocess
import threading
import os
import sys
from datetime import date, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PYTHON     = "/usr/local/bin/python3"
SCRIPT     = os.path.join(SCRIPT_DIR, "maak_waarnemingen_kaarten.py")
DOWNLOADS  = os.path.expanduser("~/Downloads")

NL_MAANDEN = ["","Januari","Februari","Maart","April","Mei","Juni",
               "Juli","Augustus","September","Oktober","November","December"]

class KaartenApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Ed Aldus WM — Waarnemingskaarten")
        self.root.resizable(False, False)
        self.root.configure(bg="#0d2b5e")

        # ── Header ────────────────────────────────────────────────────────────
        header = tk.Frame(root, bg="#0d2b5e", pady=16)
        header.pack(fill="x", padx=24)
        tk.Label(header, text="Ed Aldus", font=("Helvetica", 22, "bold"),
                 bg="#0d2b5e", fg="white").pack(anchor="w")
        tk.Label(header, text="Waarnemingen kaartgenerator",
                 font=("Helvetica", 11), bg="#0d2b5e", fg="#7fb8f7").pack(anchor="w")

        # ── Datum kiezer ──────────────────────────────────────────────────────
        frame = tk.Frame(root, bg="#112240", padx=20, pady=16)
        frame.pack(fill="x", padx=16, pady=(0,8))

        tk.Label(frame, text="Datum", font=("Helvetica", 10, "bold"),
                 bg="#112240", fg="#94a3b8").grid(row=0, column=0, sticky="w", padx=(0,12))

        datum_frame = tk.Frame(frame, bg="#112240")
        datum_frame.grid(row=0, column=1, sticky="w")

        vandaag = date.today()

        # Dag
        self.dag_var = tk.StringVar(value=str(vandaag.day))
        dagen = [str(i) for i in range(1, 32)]
        self.dag_menu = ttk.Combobox(datum_frame, textvariable=self.dag_var,
                                      values=dagen, width=4, state="readonly")
        self.dag_menu.pack(side="left", padx=(0,4))

        # Maand
        self.maand_var = tk.StringVar(value=NL_MAANDEN[vandaag.month])
        maanden = NL_MAANDEN[1:]
        self.maand_menu = ttk.Combobox(datum_frame, textvariable=self.maand_var,
                                        values=maanden, width=12, state="readonly")
        self.maand_menu.pack(side="left", padx=(0,4))

        # Jaar
        self.jaar_var = tk.StringVar(value=str(vandaag.year))
        jaren = [str(vandaag.year - i) for i in range(5)]
        self.jaar_menu = ttk.Combobox(datum_frame, textvariable=self.jaar_var,
                                       values=jaren, width=6, state="readonly")
        self.jaar_menu.pack(side="left")

        # Snelknoppen
        snel_frame = tk.Frame(frame, bg="#112240")
        snel_frame.grid(row=1, column=1, sticky="w", pady=(8,0))
        for label, delta in [("Vandaag", 0), ("Gisteren", 1), ("Eergisteren", 2)]:
            d = vandaag - timedelta(days=delta)
            tk.Button(snel_frame, text=label,
                      command=lambda d=d: self.set_datum(d),
                      bg="#2a5298", fg="white", font=("Helvetica", 9),
                      relief="flat", padx=8, pady=3, cursor="hand2").pack(side="left", padx=2)

        # ── Parameters ────────────────────────────────────────────────────────
        param_frame = tk.Frame(root, bg="#112240", padx=20, pady=12)
        param_frame.pack(fill="x", padx=16, pady=(0,8))
        tk.Label(param_frame, text="Kaarten", font=("Helvetica", 10, "bold"),
                 bg="#112240", fg="#94a3b8").pack(anchor="w", pady=(0,6))

        params = [("🌡 TX", "tx", True), ("❄️ TN", "tn", True), ("🌿 T10N", "t10n", True),
                  ("🌧 RR", "rr", True), ("💨 FX", "fx", True), ("🌬 FF", "ff", True)]
        self.param_vars = {}
        prow = tk.Frame(param_frame, bg="#112240")
        prow.pack(anchor="w")
        for label, key, default in params:
            var = tk.BooleanVar(value=default)
            self.param_vars[key] = var
            tk.Checkbutton(prow, text=label, variable=var,
                           bg="#112240", fg="white", selectcolor="#0d2b5e",
                           activebackground="#112240", activeforeground="white",
                           font=("Helvetica", 10)).pack(side="left", padx=6)

        # ── Knop ──────────────────────────────────────────────────────────────
        knop_frame = tk.Frame(root, bg="#0d2b5e", pady=10)
        knop_frame.pack(padx=16)
        self.maak_knop = tk.Button(knop_frame, text="▶  Kaarten maken",
                                    command=self.maak_kaarten,
                                    bg="#2ecc71", fg="white",
                                    font=("Helvetica", 13, "bold"),
                                    relief="flat", padx=24, pady=10,
                                    cursor="hand2", activebackground="#27ae60",
                                    activeforeground="white")
        self.maak_knop.pack()

        # ── Voortgang ─────────────────────────────────────────────────────────
        self.progress = ttk.Progressbar(root, mode="indeterminate", length=340)
        self.progress.pack(padx=16, pady=(0,6))

        # ── Log ───────────────────────────────────────────────────────────────
        log_frame = tk.Frame(root, bg="#0a1628", padx=16, pady=8)
        log_frame.pack(fill="both", expand=True, padx=16, pady=(0,16))

        self.log = tk.Text(log_frame, height=10, bg="#0a1628", fg="#94a3b8",
                           font=("Menlo", 10), relief="flat", state="disabled",
                           wrap="word")
        self.log.pack(fill="both", expand=True)

        scroll = ttk.Scrollbar(log_frame, command=self.log.yview)
        self.log["yscrollcommand"] = scroll.set

        self.log_tekst("Klaar om kaarten te maken.")

    def set_datum(self, d):
        self.dag_var.set(str(d.day))
        self.maand_var.set(NL_MAANDEN[d.month])
        self.jaar_var.set(str(d.year))

    def get_datum(self):
        try:
            dag   = int(self.dag_var.get())
            maand = NL_MAANDEN.index(self.maand_var.get())
            jaar  = int(self.jaar_var.get())
            return date(jaar, maand, dag)
        except Exception:
            return None

    def log_tekst(self, tekst, kleur=None):
        self.log.configure(state="normal")
        self.log.insert("end", tekst + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def maak_kaarten(self):
        d = self.get_datum()
        if not d:
            messagebox.showerror("Fout", "Ongeldige datum!")
            return

        geselecteerd = [k for k, v in self.param_vars.items() if v.get()]
        if not geselecteerd:
            messagebox.showwarning("Let op", "Selecteer minstens één parameter!")
            return

        self.maak_knop.configure(state="disabled")
        self.progress.start(10)
        self.log_tekst(f"\n▶ Kaarten maken voor {d.isoformat()} — {', '.join(geselecteerd).upper()}…")

        def run():
            try:
                result = subprocess.run(
                    [PYTHON, SCRIPT, d.isoformat(), ",".join(geselecteerd)],
                    cwd=SCRIPT_DIR,
                    capture_output=True, text=True
                )
                output = result.stdout + result.stderr
                for regel in output.strip().splitlines():
                    self.root.after(0, lambda r=regel: self.log_tekst(r))

                if result.returncode == 0:
                    # Kopieer gemaakte kaarten naar Downloads
                    import shutil, glob
                    dag_nl = d.strftime("%A").lower()
                    from datetime import date as date_
                    # zoek kaarten voor deze datum
                    patroon = os.path.join(SCRIPT_DIR, f"kaart_obs_*_{d.strftime('%d%b%Y').lower()}.png")
                    kaarten = glob.glob(patroon)
                    gekopieerd = 0
                    for k in kaarten:
                        param = os.path.basename(k).split("_")[2]
                        if param in geselecteerd:
                            shutil.copy(k, DOWNLOADS)
                            gekopieerd += 1
                    self.root.after(0, lambda: self.log_tekst(f"✅ {gekopieerd} kaart(en) naar Downloads gekopieerd!"))
                    self.root.after(0, lambda: subprocess.run(["open", DOWNLOADS]))
                else:
                    self.root.after(0, lambda: self.log_tekst("❌ Er is een fout opgetreden."))
            except Exception as e:
                self.root.after(0, lambda: self.log_tekst(f"❌ {e}"))
            finally:
                self.root.after(0, self.klaar)

        threading.Thread(target=run, daemon=True).start()

    def open_map(self, d):
        """Open de kaartmap in Finder."""
        subprocess.run(["open", SCRIPT_DIR])

    def klaar(self):
        self.progress.stop()
        self.maak_knop.configure(state="normal")


if __name__ == "__main__":
    root = tk.Tk()
    root.geometry("420x560")
    app = KaartenApp(root)
    root.mainloop()
