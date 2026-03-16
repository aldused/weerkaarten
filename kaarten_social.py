#!/usr/bin/env python3
"""
kaarten_social.py — Ed Aldus WM
Selecteer weerkaarten, voeg logo toe en sla op voor social media.
"""

import os, sys, glob, base64, io, subprocess, threading
from pathlib import Path
import tkinter as tk
from tkinter import ttk, messagebox, filedialog

try:
    from PIL import Image, ImageTk, ImageDraw, ImageFilter
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow", "--break-system-packages", "-q"])
    from PIL import Image, ImageTk, ImageDraw, ImageFilter

# ── Configuratie ──────────────────────────────────────────────────────────
SCRIPT_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
LOGO_PATH  = SCRIPT_DIR / "EdLogo2.png"

# Logo positie en grootte
LOGO_POSITIE   = "rechtsonder"   # linksboven / rechtsboven / linksonder / rechtsonder / midden
LOGO_GROOTTE   = 0.20            # fractie van kaartbreedte
LOGO_MARGE     = 20              # pixels marge van rand
LOGO_SCHADUW   = True            # zachte schaduw achter logo

# Kaartcategorieën
CATEGORIEEN = {
    "🌡️ Temperatuur":  "kaart_[0-9]*.png",
    "🥶 Gevoelstemp":  "kaart_gevoels_*.png",
    "💧 Dauwpunt":     "kaart_dauwpunt_*.png",
    "🌿 Grondvorst":   "kaart_t5cm_*.png",
    "💨 Wind (dag)":   "kaart_wind_[!n]*.png",
    "🌙 Wind (nacht)": "kaart_wind_nacht_*.png",
    "☀️ Zon":          "kaart_zon_*.png",
    "🌧️ Regen":        "kaart_regen_*.png",
    "🌫️ Mist":         "kaart_mist_*.png",
    "⚡ Onweer":       "kaart_onweer_*.png",
}

# ── Kleuren ───────────────────────────────────────────────────────────────
BG       = "#0d1b2a"
BG2      = "#112240"
ACCENT   = "#3b82f6"
ACCENT2  = "#1d4ed8"
TEKST    = "#e2e8f0"
TEKST2   = "#94a3b8"
RAND     = "#1e3a5f"
GROEN    = "#22c55e"
ROOD     = "#ef4444"

class KaartenApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Ed Aldus WM — Social Kaarten")
        self.configure(bg=BG)
        self.geometry("1200x800")
        self.minsize(900, 600)

        self.geselecteerd = set()
        self.thumbnails   = {}
        self.alle_kaarten = {}
        self.logo_img     = None
        self.huidig_cat   = None

        self._laad_logo()
        self._bouw_ui()
        self._scan_kaarten()

    def _laad_logo(self):
        if LOGO_PATH.exists():
            self.logo_img = Image.open(LOGO_PATH).convert("RGBA")
        else:
            messagebox.showwarning("Logo", f"Logo niet gevonden: {LOGO_PATH}\nSla EdLogo2.png op in de projectmap.")

    def _bouw_ui(self):
        # ── Header ──────────────────────────────────────────────────────
        header = tk.Frame(self, bg="#003366", pady=12, padx=20)
        header.pack(fill="x")
        tk.Label(header, text="Ed Aldus WM", font=("Arial", 18, "bold"),
                 fg="white", bg="#003366").pack(side="left")
        tk.Label(header, text="Social Kaarten — logo overlay & download",
                 font=("Arial", 10), fg="#a8c4e8", bg="#003366").pack(side="left", padx=16)

        # ── Hoofd layout ──────────────────────────────────────────────────
        hoofd = tk.Frame(self, bg=BG)
        hoofd.pack(fill="both", expand=True, padx=0, pady=0)

        # ── Zijpaneel (categorieën + instellingen) ──────────────────────
        zij = tk.Frame(hoofd, bg=BG2, width=220)
        zij.pack(side="left", fill="y")
        zij.pack_propagate(False)

        tk.Label(zij, text="CATEGORIEËN", font=("Arial", 9, "bold"),
                 fg=TEKST2, bg=BG2, pady=8).pack(fill="x", padx=12)

        self.cat_btns = {}
        for cat in CATEGORIEEN:
            btn = tk.Label(zij, text=cat, font=("Arial", 10),
                          fg=TEKST, bg=BG2, cursor="hand2",
                          pady=8, padx=14, anchor="w")
            btn.pack(fill="x")
            btn.bind("<Button-1>", lambda e, c=cat: self._wissel_cat(c))
            btn.bind("<Enter>",    lambda e, b=btn: b.configure(bg=RAND))
            btn.bind("<Leave>",    lambda e, b=btn, c=btn.cget("text"): 
                     b.configure(bg=ACCENT if c == self.huidig_cat else BG2))
            self.cat_btns[cat] = btn

        # Scheidingslijn
        tk.Frame(zij, bg=RAND, height=1).pack(fill="x", padx=8, pady=8)

        # Logo instellingen
        tk.Label(zij, text="LOGO INSTELLINGEN", font=("Arial", 9, "bold"),
                 fg=TEKST2, bg=BG2, pady=4).pack(fill="x", padx=12)

        tk.Label(zij, text="Positie", fg=TEKST2, bg=BG2,
                 font=("Arial", 9), anchor="w").pack(fill="x", padx=14)
        self.var_positie = tk.StringVar(value=LOGO_POSITIE)
        pos_combo = ttk.Combobox(zij, textvariable=self.var_positie, width=18,
                                  values=["linksboven","rechtsboven","linksonder","rechtsonder","midden"],
                                  state="readonly")
        pos_combo.pack(padx=14, pady=(0,8), fill="x")

        tk.Label(zij, text="Grootte (%)", fg=TEKST2, bg=BG2,
                 font=("Arial", 9), anchor="w").pack(fill="x", padx=14)
        self.var_grootte = tk.IntVar(value=int(LOGO_GROOTTE*100))
        tk.Scale(zij, from_=10, to=40, orient="horizontal",
                 variable=self.var_grootte, bg=BG2, fg=TEKST,
                 troughcolor=RAND, activebackground=ACCENT,
                 highlightthickness=0).pack(fill="x", padx=14, pady=(0,8))

        self.var_schaduw = tk.BooleanVar(value=LOGO_SCHADUW)
        tk.Checkbutton(zij, text="Schaduw", variable=self.var_schaduw,
                       fg=TEKST, bg=BG2, selectcolor=BG,
                       activebackground=BG2, activeforeground=TEKST,
                       font=("Arial", 9)).pack(anchor="w", padx=14, pady=(0,8))

        # Scheidingslijn
        tk.Frame(zij, bg=RAND, height=1).pack(fill="x", padx=8, pady=4)

        # Status geselecteerd
        self.lbl_select = tk.Label(zij, text="0 geselecteerd",
                                   fg=ACCENT, bg=BG2, font=("Arial", 10, "bold"))
        self.lbl_select.pack(pady=6)

        # Knoppen
        self._knop(zij, "✓ Alles in categorie", self._selecteer_alles,  "#1d4ed8").pack(fill="x", padx=10, pady=2)
        self._knop(zij, "✗ Deselecteer alles",  self._deselecteer_alles, "#4b5563").pack(fill="x", padx=10, pady=2)

        tk.Frame(zij, bg=RAND, height=1).pack(fill="x", padx=8, pady=8)

        self._knop(zij, "⬇  Download selectie", self._download_selectie, "#16a34a").pack(fill="x", padx=10, pady=2)
        self._knop(zij, "👁  Voorbeeld",          self._toon_voorbeeld,   "#2563eb").pack(fill="x", padx=10, pady=2)

        # ── Kaarten grid (scrollbaar) ─────────────────────────────────────
        rechts = tk.Frame(hoofd, bg=BG)
        rechts.pack(side="left", fill="both", expand=True)

        self.canvas = tk.Canvas(rechts, bg=BG, highlightthickness=0)
        scroll = ttk.Scrollbar(rechts, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)

        self.grid_frame = tk.Frame(self.canvas, bg=BG)
        self.canvas_window = self.canvas.create_window((0,0), window=self.grid_frame, anchor="nw")

        self.grid_frame.bind("<Configure>", self._on_frame_configure)
        self.canvas.bind("<Configure>",     self._on_canvas_configure)
        self.canvas.bind("<MouseWheel>",    lambda e: self.canvas.yview_scroll(-1*(e.delta//120), "units"))
        self.canvas.bind("<Button-4>",      lambda e: self.canvas.yview_scroll(-1, "units"))
        self.canvas.bind("<Button-5>",      lambda e: self.canvas.yview_scroll(1, "units"))

        # Status balk
        self.status = tk.Label(self, text="Klaar", fg=TEKST2, bg=BG,
                               font=("Arial", 9), anchor="w", padx=12)
        self.status.pack(fill="x", side="bottom", pady=4)

    def _knop(self, parent, tekst, cmd, kleur):
        lbl = tk.Label(parent, text=tekst, command=None,
                       bg=kleur, fg="white", font=("Arial", 10, "bold"),
                       relief="flat", pady=10, cursor="hand2", anchor="center")
        lbl.bind("<Button-1>", lambda e: cmd())
        lbl.bind("<Enter>", lambda e: lbl.configure(bg=self._lichter(kleur)))
        lbl.bind("<Leave>", lambda e: lbl.configure(bg=kleur))
        return lbl

    def _lichter(self, hex_kleur):
        r = min(255, int(hex_kleur[1:3], 16) + 30)
        g = min(255, int(hex_kleur[3:5], 16) + 30)
        b = min(255, int(hex_kleur[5:7], 16) + 30)
        return f"#{r:02x}{g:02x}{b:02x}"

    def _on_frame_configure(self, e):
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))

    def _on_canvas_configure(self, e):
        self.canvas.itemconfig(self.canvas_window, width=e.width)

    def _scan_kaarten(self):
        self.alle_kaarten = {}
        for cat, patroon in CATEGORIEEN.items():
            bestanden = sorted(glob.glob(str(SCRIPT_DIR / patroon)))
            # Filter wind_nacht uit wind_dag
            if cat == "💨 Wind (dag)":
                bestanden = [b for b in bestanden if "wind_nacht" not in b]
            if bestanden:
                self.alle_kaarten[cat] = bestanden

        if self.alle_kaarten:
            eerste = next(iter(self.alle_kaarten))
            self._wissel_cat(eerste)
            self._status(f"{sum(len(v) for v in self.alle_kaarten.values())} kaarten gevonden")
        else:
            self._status("Geen kaarten gevonden — draai eerst upload_kaarten.sh", ROOD)

    def _wissel_cat(self, cat):
        self.huidig_cat = cat
        for c, btn in self.cat_btns.items():
            btn.configure(bg=ACCENT if c == cat else BG2)
        self._toon_grid(self.alle_kaarten.get(cat, []))

    def _toon_grid(self, bestanden):
        for w in self.grid_frame.winfo_children():
            w.destroy()
        self.thumbnails = {}

        COLS = 3
        for i, pad in enumerate(bestanden):
            rij = i // COLS
            kol = i % COLS
            self._maak_kaart_widget(pad, rij, kol)

    def _maak_kaart_widget(self, pad, rij, kol):
        naam = os.path.basename(pad)
        geselecteerd = pad in self.geselecteerd

        frame = tk.Frame(self.grid_frame, bg=ACCENT if geselecteerd else BG2,
                         padx=2, pady=2)
        frame.grid(row=rij, column=kol, padx=8, pady=8, sticky="nsew")
        self.grid_frame.columnconfigure(kol, weight=1)

        # Thumbnail
        try:
            img = Image.open(pad)
            img.thumbnail((320, 440))
            tk_img = ImageTk.PhotoImage(img)
            self.thumbnails[pad] = tk_img
            lbl_img = tk.Label(frame, image=tk_img, bg=BG2, cursor="hand2")
            lbl_img.pack(fill="x")
        except Exception as e:
            lbl_img = tk.Label(frame, text=f"⚠ {naam}", fg=ROOD, bg=BG2)
            lbl_img.pack()

        # Naam label
        # Maak mooier label van bestandsnaam
        label_tekst = naam.replace("kaart_","").replace("_"," ").replace(".png","").title()
        tk.Label(frame, text=label_tekst, fg=TEKST, bg=BG2,
                 font=("Arial", 9), wraplength=280, pady=4).pack(fill="x", padx=6)

        # Selectie toggle
        def toggle(e=None, p=pad, f=frame):
            if p in self.geselecteerd:
                self.geselecteerd.discard(p)
                f.configure(bg=BG2)
                for child in f.winfo_children():
                    if isinstance(child, tk.Label): child.configure(bg=BG2)
            else:
                self.geselecteerd.add(p)
                f.configure(bg=ACCENT)
                for child in f.winfo_children():
                    if isinstance(child, tk.Label): child.configure(bg=ACCENT)
            self.lbl_select.configure(text=f"{len(self.geselecteerd)} geselecteerd")

        lbl_img.bind("<Button-1>", toggle)
        frame.bind("<Button-1>", toggle)

        # Selectie indicator
        check = tk.Label(frame, text="✓ Geselecteerd" if geselecteerd else "Klik om te selecteren",
                         fg="white" if geselecteerd else TEKST2,
                         bg=ACCENT if geselecteerd else BG2,
                         font=("Arial", 9, "bold"), pady=4)
        check.pack(fill="x", padx=6, pady=(0,4))
        check.bind("<Button-1>", toggle)

    def _selecteer_alles(self):
        if self.huidig_cat and self.huidig_cat in self.alle_kaarten:
            for pad in self.alle_kaarten[self.huidig_cat]:
                self.geselecteerd.add(pad)
            self.lbl_select.configure(text=f"{len(self.geselecteerd)} geselecteerd")
            self._toon_grid(self.alle_kaarten.get(self.huidig_cat, []))

    def _deselecteer_alles(self):
        self.geselecteerd.clear()
        self.lbl_select.configure(text="0 geselecteerd")
        if self.huidig_cat:
            self._toon_grid(self.alle_kaarten.get(self.huidig_cat, []))

    def _voeg_logo_toe(self, kaart_pad):
        """Voeg logo toe aan kaart en geef PIL Image terug."""
        kaart = Image.open(kaart_pad).convert("RGBA")
        breedte, hoogte = kaart.size

        if self.logo_img is None:
            return kaart.convert("RGB")

        # Logo schalen
        logo_breedte = int(breedte * self.var_grootte.get() / 100)
        ratio = logo_breedte / self.logo_img.width
        logo_hoogte = int(self.logo_img.height * ratio)
        logo = self.logo_img.resize((logo_breedte, logo_hoogte), Image.LANCZOS)

        # Positie bepalen
        marge = LOGO_MARGE
        pos = self.var_positie.get()
        if pos == "linksboven":    x, y = marge, marge
        elif pos == "rechtsboven": x, y = breedte - logo_breedte - marge, marge
        elif pos == "linksonder":  x, y = marge, hoogte - logo_hoogte - marge
        elif pos == "rechtsonder": x, y = breedte - logo_breedte - marge, hoogte - logo_hoogte - marge
        else:                      x, y = (breedte - logo_breedte)//2, (hoogte - logo_hoogte)//2

        # Schaduw
        if self.var_schaduw.get():
            schaduw = Image.new("RGBA", kaart.size, (0,0,0,0))
            schaduwig = Image.new("RGBA", logo.size, (0,0,0,120))
            schaduw.paste(schaduwig, (x+4, y+4), logo.split()[3])
            schaduw = schaduw.filter(ImageFilter.GaussianBlur(6))
            kaart = Image.alpha_composite(kaart, schaduw)

        # Logo plakken
        kaart.paste(logo, (x, y), logo.split()[3])
        return kaart.convert("RGB")

    def _toon_voorbeeld(self):
        if not self.geselecteerd:
            messagebox.showinfo("Voorbeeld", "Selecteer eerst een kaart.")
            return
        pad = next(iter(self.geselecteerd))
        self._status("Voorbeeld genereren...")
        threading.Thread(target=self._voorbeeld_thread, args=(pad,), daemon=True).start()

    def _voorbeeld_thread(self, pad):
        try:
            resultaat = self._voeg_logo_toe(pad)
            tk_img = ImageTk.PhotoImage(resultaat.resize(
                (int(resultaat.width*0.5), int(resultaat.height*0.5)), Image.LANCZOS))
            self.after(0, lambda: self._toon_voorbeeld_venster(tk_img, resultaat))
        except Exception as e:
            self.after(0, lambda: self._status(f"Fout: {e}", ROOD))

    def _toon_voorbeeld_venster(self, tk_img, resultaat):
        win = tk.Toplevel(self)
        win.title("Voorbeeld")
        win.configure(bg=BG)
        lbl = tk.Label(win, image=tk_img, bg=BG)
        lbl.image = tk_img
        lbl.pack(padx=16, pady=16)
        knop = self._knop(win, "⬇ Sla op", lambda: self._sla_op_enkel(resultaat, win), "#16a34a")
        knop.pack(pady=(0,16), padx=16, fill="x")
        self._status("Voorbeeld klaar")

    def _sla_op_enkel(self, img, win=None):
        pad = filedialog.asksaveasfilename(
            defaultextension=".jpg",
            filetypes=[("JPEG", "*.jpg"), ("PNG", "*.png")],
            initialdir=str(Path.home() / "Desktop"),
            title="Opslaan als")
        if pad:
            kwaliteit = 95 if pad.endswith(".jpg") else None
            if kwaliteit:
                img.save(pad, quality=kwaliteit)
            else:
                img.save(pad)
            self._status(f"Opgeslagen: {os.path.basename(pad)}", GROEN)
            if win: win.destroy()

    def _download_selectie(self):
        if not self.geselecteerd:
            messagebox.showinfo("Download", "Selecteer eerst kaarten.")
            return
        if len(self.geselecteerd) == 1:
            pad = next(iter(self.geselecteerd))
            img = self._voeg_logo_toe(pad)
            self._sla_op_enkel(img)
            return

        # Meerdere: kies map
        doel_map = filedialog.askdirectory(
            initialdir=str(Path.home() / "Desktop"),
            title="Kies map voor opslaan")
        if not doel_map:
            return
        self._status(f"Exporteren {len(self.geselecteerd)} kaarten...")
        threading.Thread(target=self._export_thread, args=(doel_map,), daemon=True).start()

    def _export_thread(self, doel_map):
        fouten = []
        for i, pad in enumerate(sorted(self.geselecteerd)):
            try:
                resultaat = self._voeg_logo_toe(pad)
                naam = os.path.basename(pad).replace(".png", "_social.jpg")
                doel = os.path.join(doel_map, naam)
                resultaat.save(doel, quality=95)
                self.after(0, lambda n=naam, j=i+1, t=len(self.geselecteerd):
                           self._status(f"({j}/{t}) Opgeslagen: {n}"))
            except Exception as e:
                fouten.append(f"{os.path.basename(pad)}: {e}")

        def klaar():
            if fouten:
                messagebox.showerror("Fouten", "\n".join(fouten))
            else:
                messagebox.showinfo("Klaar", f"{len(self.geselecteerd)} kaarten opgeslagen in:\n{doel_map}")
            self._status(f"Export klaar — {len(self.geselecteerd)} kaarten", GROEN)
        self.after(0, klaar)

    def _status(self, tekst, kleur=TEKST2):
        self.status.configure(text=tekst, fg=kleur)

if __name__ == "__main__":
    app = KaartenApp()
    app.mainloop()
