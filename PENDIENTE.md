# Pendiente

## Por dónde vamos (17/10)
Hecho y probado (e2e 57/57 y 72/72):
- Interfaz entera en Caelestia sin color (Figtree, vidrio, píldoras); colores de estado vivos (sectores, banderas, avisos, pedales).
- Fuera la barra «Muro» en escritorio; «Pausa en avisos» en la cabecera de Avisos y en el menú (Esc).
- Mánager: sus coches ya no paran solos con el plan; la parada del plan es un aviso y un botón amarillo.
- Vertical (móvil de pie o pantalla dividida): 3D arriba y pestañas Muro / Tiempos / Piloto / Mapa + menú ☰; en ancho, tiempos fijos a la izquierda.
- Banda de compuesto de las ruedas del coche más ancha y con brillo propio.

Queda:
- Mirar la foto de las ruedas (`scratchpad/tyres.jpg`) y decidir si basta.
- Revisar en vertical: portada, pausa, multijugador (sala y votaciones), repetición y radio.
- Que lo pruebe él en el móvil de verdad.

## Decidido (17/10)
- Visibilidad C por defecto (D cuesta un 18 % de FPS en gp y se ve casi igual). `?look=a` vuelve a la de antes.
- Motor D (orgánico y grave), 3 dB más bajo que el de antes; ambiente B (murmullo de público y rachas de viento). `?motor=a&amb=a` vuelve al de antes.

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
