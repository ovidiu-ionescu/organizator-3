# https://stackoverflow.com/questions/2683279/how-to-detect-if-a-script-is-being-sourced
[[ "${BASH_SOURCE[0]}" == "${0}" ]] && echo "run as . ${BASH_SOURCE[0]} to \
modify the environment" && exit 1

alias k='kubectl -n organizator-dev'
alias h='helm -n organizator-dev'

eval $(minikube docker-env)

