FROM node:20-alpine
WORKDIR /src
COPY package.json package-lock.json /src
RUN npm install
COPY . /src
ENTRYPOINT ["npm","exec","github-release-downloads","--"]
