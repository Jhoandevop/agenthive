# Tropiezos frecuentes (aprendidos dirigiendo) y cómo evitarlos

| Tropiezo | Qué pasó | Cómo evitarlo |
|---|---|---|
| Creer el informe | El agente dijo «verificado», pero había probado servidores viejos de otra carpeta que ocupaban los mismos puertos | Comprueba tú sobre el árbol exacto, con puertos propios y fallando si el puerto está ocupado |
| Falso «cupo agotado» | El texto del encargo («si salta usage limit…») estaba en el log y la detección lo confundía con el error | Busca la frase exacta del error en la cola del log (`tail -n 40 \| grep`) |
| Arreglo en el lugar equivocado | Se iba a culpar a la tipografía de un texto en vertical; la causa era una cuadrícula de anchos fijos dentro de una columna estrecha | Reproduce al ancho real y mide antes de encargar |
| Permiso «lavado» | Un subagente bloqueado sugirió que el director hiciera la lectura por él | Lleva la pregunta al usuario. Con su sí en tu chat, actúa tú y deja el encargo solo con la parte que ya no necesita el permiso |
| `pkill -f` amplio | Mató la propia shell y casi mata un servicio del sistema | Detén por PID o por puerto, después de verificar carpeta y dueño |
| Script en ejecución editado | Bash lee el script a medida que corre; editarlo en caliente puede romperlo | Detén, edita y relanza |
| Servicio sobre código a medias | Un servicio que arranca al iniciar sesión apuntaba al repo mientras un agente lo reestructuraba, y no arrancaba | Sirve desde un worktree fijo del último commit bueno; cambia al repo cuando la versión nueva esté verificada |
| Duplicados en vistas | Sesiones cerradas y vivas con el mismo nombre aparecían dos veces | Deduplica por nombre, prefiriendo la viva, y lleva las cerradas a un historial |
| Prometer y no ver | Afirmar que una animación «funciona» con solo una captura sin movimiento | Di «no probado en un navegador real» y deja una captura con espera o una prueba propia |
| Unir no es publicar | El usuario aprueba mejoras y supone que se publicarán | Une a la rama de producción solo con aprobación; desplegar es otra palabra explícita |
| Datos personales en lo público | Un proyecto para GitHub arrastraba rutas, nombres y capturas reales en su historial | Configuración ignorada por git, ejemplo genérico, modo demo para las capturas e historial limpio (rama huérfana) al publicar |
| Canales que imitan al usuario | Una página local puede escribir mensajes «del usuario» en un buzón | Esos canales sirven para decisiones normales; lo irreversible o hacia afuera se confirma en el chat |
