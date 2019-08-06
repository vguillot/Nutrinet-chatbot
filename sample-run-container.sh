#!/bin/bash

# arquivo de exemplo para iniciar o container
export SOURCE_DIR='/home/jordan/MEGAsync Downloads/Projetos/Nutrinet-chatbot'
export DATA_DIR='/tmp/alda-chatbot/data/'

mkdir -p $DATA_DIR/sessions
chown -R 1000:1000 $DATA_DIR/sessions

# confira o seu ip usando ifconfig docker0|grep 'inet addr:'
export DOCKER_LAN_IP=172.17.0.1

# porta que será feito o bind
export LISTEN_PORT=5060

docker run --name nutrinet_chatbot \
 -v $DATA_DIR/sessions:/src/.sessions \
 -p $DOCKER_LAN_IP:$LISTEN_PORT:1237 \
 --cpu-shares=256 \
 --memory 800m -dit --restart unless-stopped appcivico/nutrinet-chatbot