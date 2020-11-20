#!/usr/bin/env groovy

pipeline {
	agent {
		docker {
			image 'node:10'
			args '-u 0'
		}
	}
	environment {
		CI = 'true'
	}
	stages {
		stage('Lint') {
			steps {
				sh 'make lint-checkstyle'
				recordIssues qualityGates: [[threshold: 1, type: 'TOTAL_ERROR', unstable: false]], tools: [esLint(pattern: 'test/tests.eslint.xml')], unhealthy: 50
			}
		}
		stage('Build') {
			steps {
				sh 'make DATE=reproducible'
				sh 'sha256sum ./umd/kwm.js*'
			}
		}
		stage('Docs') {
			steps {
				publishHTML([allowMissing: false, alwaysLinkToLastBuild: false, keepAll: true, reportDir: 'docs/', reportFiles: 'index.html', reportName: 'Documentation', reportTitles: ''])
			}
		}
		stage('Dist') {
			steps {
				sh '$(git diff --stat)'
				sh 'test -z "$(git diff --shortstat 2>/dev/null |tail -n1)" && echo "Clean check passed."'
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
