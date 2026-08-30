-- Puente de ejecucion del cliente KCM para Excel en macOS.
--
-- QUE HACE. Recibe un vector de argumentos separados por tabulador, lo ejecuta y
-- devuelve su salida. Nada mas. No conoce el protocolo del puente, no sabe que es
-- una matriz y no toma ninguna decision: eso vive en el modulo KcmPlataforma del
-- libro, que es donde se puede leer y revisar.
--
-- POR QUE EXISTE. Excel para Mac corre en una caja de arena. Desde VBA se puede
-- llamar a `popen` de libSystem, pero el proceso hijo hereda esa caja: alcanza la
-- red, y no siempre puede leer un archivo que viva fuera del contenedor de Excel.
-- `AppleScriptTask` es la via que Microsoft dejo abierta a proposito para eso, y
-- lo que se ejecuta desde aqui corre FUERA de la caja de arena. Por eso es la via
-- principal; `popen` queda como respaldo cuando este archivo no esta instalado.
--
-- POR QUE NO RECIBE UNA LINEA DE SHELL. Recibe argumentos sueltos y los entrecomilla
-- uno por uno con `quoted form of`, que es la primitiva de AppleScript para esto.
-- Asi una ruta con espacios, un endpoint con caracteres raros o un valor pegado en
-- KCM_CONFIG no pueden inyectar un comando: cualquier cosa que llegue es un
-- argumento, nunca sintaxis.
--
-- DONDE SE INSTALA. En `~/Library/Application Scripts/com.microsoft.Excel/`, que es
-- la unica carpeta desde la que Excel puede invocarlo. `excel/mac/instalar-puente-mac.sh`
-- lo copia ahi. El nombre del archivo tiene que ser exactamente KcmPuente.applescript,
-- porque es el que el modulo KcmPlataforma pide.
--
-- QUE DEVUELVE. Una cadena que empieza en "OK:" con la salida del comando, o en
-- "ERR:" con el motivo del fallo. El libro no lanza excepciones a traves de esta
-- frontera: las lee del prefijo.

on kcmComando(argumentos)
	set piezas to kcmPartirEnTabuladores(argumentos as text)
	if (count of piezas) is 0 then return "ERR:vector de argumentos vacio"

	set laOrden to ""
	repeat with unaPieza in piezas
		set laOrden to laOrden & quoted form of (unaPieza as text) & " "
	end repeat

	try
		-- Sin `with administrator privileges` y sin cambiar de usuario: corre como
		-- quien tiene la sesion abierta, que es quien debe poder leer la matriz.
		return "OK:" & (do shell script laOrden)
	on error mensaje number numero
		return "ERR:" & (numero as text) & " " & mensaje
	end try
end kcmComando

-- Reparte el vector recorriendo el texto, sin tocar `text item delimiters`.
--
-- La via natural en AppleScript seria fijar esa propiedad y pedir `text items`,
-- y asi estaba escrito. Funciona al invocar el guion desde `osascript`, pero
-- **no dentro de `AppleScriptTask`**: en ese contexto la asignacion no surte
-- efecto, el texto vuelve en una sola pieza y el vector entero termina
-- entrecomillado como si fuera el nombre de un programa. El sintoma es un
-- `sh: /bin/date<tab>+%z: No such file or directory` con codigo 127, y solo
-- aparece corriendo desde Excel. `offset` no depende de ningun estado global.
on kcmPartirEnTabuladores(elTexto)
	set piezas to {}
	set resto to elTexto
	repeat
		set corte to offset of tab in resto
		if corte is 0 then
			set end of piezas to resto
			exit repeat
		end if
		if corte is 1 then
			set end of piezas to ""
		else
			set end of piezas to text 1 thru (corte - 1) of resto
		end if
		if corte is (count of resto) then
			set resto to ""
		else
			set resto to text (corte + 1) thru -1 of resto
		end if
	end repeat
	return piezas
end kcmPartirEnTabuladores

-- Eco de diagnostico. No participa en la operacion: devuelve los codigos de los
-- caracteres que cruzaron la frontera desde VBA, para saber si el separador de
-- argumentos llego intacto. Se invoca a mano desde la ventana Inmediato.
on kcmEco(argumentos)
	set laCadena to argumentos as text
	set codigos to ""
	repeat with indice from 1 to (count of laCadena)
		set codigos to codigos & (id of (character indice of laCadena)) & " "
	end repeat
	return "ECO:" & (count of laCadena) & ":" & codigos
end kcmEco
