# Envia uma planilha para o painel Tea Shop (Windows / PowerShell).
# uso: .\enviar-planilha.ps1 torres importacaoA "C:\Relatorios\vendas.xlsx"
param([string]$Loja, [string]$Arquivo, [string]$Caminho)
$Painel = "https://painel.seudominio.com.br"
$Token  = "COLE_AQUI_O_TOKEN_DE_UPLOAD"
$r = Invoke-RestMethod -Method Post -Uri "$Painel/api/upload/$Loja/$Arquivo" `
     -Headers @{ Authorization = "Bearer $Token" } -InFile $Caminho `
     -ContentType "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
$r | ConvertTo-Json
