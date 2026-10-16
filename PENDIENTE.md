# Pendiente

## Esperan tu decisión (ver `propuestas/index.html`)
- **Rediseño de la interfaz**: tres maquetas (Caelestia, Nothing, retransmisión pulida). Elegir una y la aplico a todo.
- **Visibilidad con poco brillo**: ajustes A (como ahora), B (más luz), C (más contraste), D (C + barniz). Se prueban en el juego con `?look=c`.
- **Sonido**: motor A/B/C/D y ambiente A/B, en WAV y grabados en el juego. En el juego: `?motor=b&amb=b`.

## Hecho (16/10, noche)
- Saltar: tu equipo lo lleva la IA hasta el final de la sesión (sale, aprende, cambia gomas, para).
- Saltar un 12 % más rápido; opción en la portada para libres de 60/30/15 min (lo que más espera en espectador).
- Daños solo estéticos, se arreglan en boxes al instante; la IA vuelve a boxes si rompe algo en libres/clasificación.
- Repetición con piezas rotas, trozos y chispas; tecpro solo donde lo hay; choque contra la cara del tecpro.
- Alcances con empujón y rebote; los saltos de lado (teletransportes) se dibujan como un deslizamiento.
- Val d'Ambre: más escapatoria en las 9 curvas donde más se salían (abandonos 27 → 15); menos atascos en grava en todos.
- Lluvia: más variedad en el cambio a gomas de agua cuando la decisión es dudosa.
- Cámaras: volante que gira en el cockpit, trasera más usada y mejor encuadrada, dron más abierto.
- Carteles del muro al derecho desde la grada.
- Muro: sin textos de relleno, avisos en columna propia (caben varios); garaje más grande; Rendimiento con filtros etiquetados.
- Aprendizaje medido por «dominio» (vuelta teórica frente a la ideal, con lo que pierde por trazada y por ataque).
- Resultados de carrera: estadísticas (posiciones vuelta a vuelta, estrategias, ritmo, destacados).
- Móvil: vertical y horizontal (espectador y mánager).
- e2e: arreglado el fallo intermitente de la tecla 7.

## Queda
- Val d'Ambre va a ~68 FPS (Monte Alto ~79) con la GPU en ahorro. Probé detalle de árboles según la distancia a la cámara y fue más lento: descartado.
- Simulación: el coste está repartido (aprendizaje 26 %, física 30 %); acelerar más pide cambios grandes. Alternativa ya hecha: libres más cortas.
- Multijugador: sin probar con dos personas de verdad.
- Choques: el abandono con coche de seguridad virtual ya existía; no hay coche de seguridad «de verdad».

## Más adelante (ahora no)
- Temporada con puntos y desarrollo del coche entre carreras.
- Más circuitos.
