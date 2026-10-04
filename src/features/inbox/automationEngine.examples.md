# Casos de ejemplo (el repo no tiene runner de tests)

## renderTemplate (verificados a mano con node --experimental-strip-types)
- `Hola {{nombre}}, gracias por escribirnos por {{propiedad}}. {{foo}} Atendemos {{horario}}.` con nombre vacío, sin propiedad, horario "lunes a viernes" -> `Hola, gracias por escribirnos. Atendemos lunes a viernes.`
- `¡Hola {{ nombre }}! Visita a {{propiedad}} por {{precio}}` con datos -> `¡Hola Ana! Visita a Depto por USD 5`
- Variable desconocida o `{{` suelto: nunca queda literal en el texto enviado.

## planAutomations (a verificar a mano o con un futuro runner)
- first_message, delay 5 min, regla activada a las 10:00: cliente escribe 10:02, now 10:06 -> 1 envío; now 10:05 -> ninguno hasta 10:07.
- Cliente escribió antes de `enabledAt` -> ninguno.
- Un agente ya respondió -> first_message no dispara.
- off_hours: mensaje del cliente sábado 20:00 BA con horario L-V 9-18 -> envía; segundo mensaje a las 2 h -> no (cooldown 12 h); a las 13 h -> sí.
- no_reply 24 h: último mensaje nuestro hace 25 h y el cliente no contestó -> 1 envío; con entrada `ok` en sentLog -> nunca más.
- Entrada `error` con attempts 3 -> no reintenta; con attempts 1 y nextRetryAt futuro -> espera.
- Un mensaje de agente con el mismo texto ya existente -> no envía (otro navegador se adelantó).
