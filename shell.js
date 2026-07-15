(() => {
  "use strict";
  const frame = document.getElementById("moduleFrame");
  const title = document.getElementById("moduleTitle");
  const description = document.getElementById("moduleDescription");
  const label = document.getElementById("workspaceLabel");
  const hint = document.getElementById("workspaceHint");
  const openButton = document.getElementById("openModule");
  const reloadButton = document.getElementById("reloadModule");
  const buttons = [...document.querySelectorAll("[data-module]")];

  const modules = {
    materials: {
      title: "Materials Analytics",
      description: "Import, mapowanie, normalizacja wartości, walidacja, analiza sezonowa, Pivot, wykresy i eksport.",
      hint: "Tryb biznesowy"
    },
    trainer: {
      title: "Excel Data Lab",
      description: "Podgląd, wyszukiwanie, jakość danych, czyszczenie, obliczenia warunkowe, Pivot, wykresy i pełny raport Excel.",
      hint: "Tryb uniwersalny"
    },
    intelligence: {
      title: "Material Intelligence Center",
      description: "Dashboard operacyjny, kondycja materiałów, coverage days, ryzyko braków, Pareto, ABC, sezonowość i forecast.",
      hint: "Tryb decyzyjny"
    }
  };

  function activate(button) {
    const key = button.dataset.module;
    const config = modules[key];
    if (!config) return;
    buttons.forEach(item => item.classList.toggle("is-active", item === button));
    frame.src = button.dataset.src;
    frame.title = config.title;
    title.textContent = config.title;
    description.textContent = config.description;
    label.textContent = config.title;
    hint.textContent = config.hint;
    localStorage.setItem("ema.activeModule", key);
  }

  buttons.forEach(button => button.addEventListener("click", () => activate(button)));
  reloadButton.addEventListener("click", () => frame.contentWindow?.location.reload());
  openButton.addEventListener("click", () => window.open(frame.src, "_blank", "noopener"));

  const saved = localStorage.getItem("ema.activeModule");
  const initial = buttons.find(button => button.dataset.module === saved) || buttons[0];
  activate(initial);
})();
