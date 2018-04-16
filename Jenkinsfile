#!/usr/bin/env groovy

pipeline {
	agent {
		docker {
			image 'node:9'
			args '-u 0'
		}
	}
	stages {
		stage('build') {
			steps {
				sh 'make'
			}
		}
		stage('dist') {
			when {
				branch 'master'
			}
			steps {
				sh 'make dist'
				archiveArtifacts artifacts: 'dist/*.tgz', fingerprint: true
			}
		}
	}
    post {
        always {
            cleanWs()
        }
    }
}
