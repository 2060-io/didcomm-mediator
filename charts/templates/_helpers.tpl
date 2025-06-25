{{- define "didcomm-mediator.name" -}}
{{- .Chart.Name -}}
{{- end -}}

{{- define "didcomm-mediator.fullname" -}}
{{- printf "%s" .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "didcomm-mediator.labels" -}}
helm.sh/chart: {{ include "didcomm-mediator.name" . }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "didcomm-mediator.selectorLabels" -}}
app.kubernetes.io/name: {{ include "didcomm-mediator.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
